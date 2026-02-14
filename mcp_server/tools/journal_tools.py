"""Journal-related MCP tools."""

import json
import os
import threading
from datetime import date, datetime
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP
from openai import OpenAI

from mcp_server.db import (
    create_journal_entry,
    db_available,
    get_entries_with_empty_event_payload,
    get_journal_events as db_get_journal_events,
    get_parse_status,
    get_recent_events,
    get_recent_entries,
    init_db,
    replace_journal_events,
    save_recommendation_feedback,
    search_entries,
    set_parse_status,
)
from mcp_server.journal_parser import parse_journal_events
from mcp_server.tools.whoop_tools import get_whoop_multi_window_signals
from mcp_server.workout_principles import load_workout_principles

_openai_client: Optional[OpenAI] = None
_journal_db_initialized = False


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI()
    return _openai_client


def _ensure_journal_db() -> tuple[bool, str | None]:
    global _journal_db_initialized
    if not db_available():
        return False, "DATABASE_URL is not configured."
    if not _journal_db_initialized:
        if not init_db():
            return False, "Database initialization failed."
        _journal_db_initialized = True
    return True, None


def _normalize_entry_date(entry_date: Optional[str]) -> date:
    if not entry_date:
        return date.today()
    return date.fromisoformat(entry_date)


def _run_parse_job(entry_id: int, raw_text: str) -> None:
    set_parse_status(entry_id, "processing", None)
    last_error: str | None = None
    for attempt in (1, 2):
        try:
            events = parse_journal_events(
                client=_get_openai_client(),
                model=os.getenv("JOURNAL_PARSER_MODEL", "gpt-4o-mini"),
                raw_text=raw_text,
            )
            replace_journal_events(entry_id, events)
            set_parse_status(entry_id, "success", None)
            return
        except Exception as exc:
            last_error = f"attempt {attempt} failed: {exc}"
    set_parse_status(entry_id, "failed", last_error or "parse failed")


def _is_high_stress(payload: dict) -> bool:
    level = str(payload.get("stress_level", "")).lower()
    summary = str(payload.get("summary", "")).lower()
    return level == "high" or "high" in summary


def _is_low_recovery(payload: dict) -> bool:
    energy = str(payload.get("energy", "")).lower()
    summary = str(payload.get("summary", "")).lower()
    soreness = payload.get("soreness_areas", [])
    return energy in {"low", "tired", "exhausted"} or "low" in summary or len(soreness) >= 2


def _days_ago(entry_date: str) -> int:
    try:
        d = date.fromisoformat(entry_date)
        return (date.today() - d).days
    except Exception:
        return 999


def _llm_synthesize_recommendation(
    context: dict[str, Any],
    fallback_recommendation: str,
    fallback_rationale: list[str],
) -> tuple[dict[str, Any] | None, str | None]:
    prompt = f"""
You are a performance coach. Build the next workout recommendation from structured signals.
Return STRICT JSON only with this schema:
{{
  "recommendation": "short actionable recommendation",
  "session_focus": "string",
  "intensity": "low|moderate|high",
  "rationale": ["reason 1", "reason 2"],
  "cautions": ["optional caution 1"],
  "confidence": 0.0
}}

Context:
{json.dumps(context, indent=2)}

Constraints:
- Use short-term readiness signals (stress/recovery/sleep/strain) heavily.
- Respect muscle cooldown and undertraining hints.
- Keep rationale specific and tied to provided signals.
- If readiness is poor, prefer recovery/easy training.
"""
    try:
        response = _get_openai_client().chat.completions.create(
            model=os.getenv("RECOMMENDER_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "Return only valid JSON. No markdown."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        data = json.loads(response.choices[0].message.content or "{}")
        rec = str(data.get("recommendation", "")).strip()
        rationale = data.get("rationale", [])
        if not rec or not isinstance(rationale, list) or not rationale:
            return None, "LLM returned incomplete recommendation payload."
        out = {
            "recommendation": rec,
            "session_focus": str(data.get("session_focus", "")).strip(),
            "intensity": str(data.get("intensity", "moderate")).strip().lower(),
            "rationale": [str(x) for x in rationale][:6],
            "cautions": [str(x) for x in data.get("cautions", [])][:6] if isinstance(data.get("cautions", []), list) else [],
            "confidence": float(data.get("confidence", 0.65)),
        }
        return out, None
    except Exception as exc:
        # Fallback remains deterministic and safe.
        return {
            "recommendation": fallback_recommendation,
            "session_focus": "fallback_rules",
            "intensity": "moderate",
            "rationale": fallback_rationale,
            "cautions": [],
            "confidence": 0.5,
        }, str(exc)


def register_journal_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_workout_principles() -> str:
        return json.dumps(load_workout_principles(), indent=2)

    @mcp.tool()
    def save_journal_entry(content: str, entry_date: Optional[str] = None) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        try:
            parsed_date = _normalize_entry_date(entry_date)
        except ValueError:
            return json.dumps({"error": "Invalid date format. Use YYYY-MM-DD."}, indent=2)

        row = create_journal_entry(content, parsed_date)
        worker = threading.Thread(
            target=_run_parse_job,
            args=(int(row["entry_id"]), content),
            daemon=True,
        )
        worker.start()
        return json.dumps(
            {
                "entry_id": row["entry_id"],
                "entry_date": row["entry_date"],
                "parse_status": row["parse_status"],
                "message": "Journal saved. Parsing is running asynchronously.",
            },
            indent=2,
        )

    @mcp.tool()
    def get_journal_parse_status(entry_id: int) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        row = get_parse_status(entry_id)
        if not row:
            return json.dumps({"error": f"Entry {entry_id} not found."}, indent=2)
        return json.dumps(row, indent=2)

    @mcp.tool()
    def get_recent_journal(days: int = 7, limit: int = 20) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        rows = get_recent_entries(days=days, limit=limit)
        return json.dumps({"entries": rows, "count": len(rows)}, indent=2)

    @mcp.tool()
    def search_journal(query: str, limit: int = 10) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        rows = search_entries(query=query, limit=limit)
        return json.dumps({"entries": rows, "count": len(rows)}, indent=2)

    @mcp.tool()
    def get_journal_events(entry_id: int) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        rows = db_get_journal_events(entry_id)
        return json.dumps({"entry_id": entry_id, "events": rows, "count": len(rows)}, indent=2)

    @mcp.tool()
    def reparse_empty_payload_entries(limit: int = 20) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        targets = get_entries_with_empty_event_payload(limit=limit)
        reparsed = 0
        failed: list[dict] = []
        for target in targets:
            entry_id = int(target["entry_id"])
            raw_text = str(target["raw_text"])
            try:
                set_parse_status(entry_id, "processing", None)
                events = parse_journal_events(
                    client=_get_openai_client(),
                    model=os.getenv("JOURNAL_PARSER_MODEL", "gpt-4o-mini"),
                    raw_text=raw_text,
                )
                replace_journal_events(entry_id, events)
                set_parse_status(entry_id, "success", None)
                reparsed += 1
            except Exception as exc:
                set_parse_status(entry_id, "failed", str(exc))
                failed.append({"entry_id": entry_id, "error": str(exc)})
        return json.dumps(
            {
                "requested_limit": limit,
                "found": len(targets),
                "reparsed": reparsed,
                "failed": failed,
            },
            indent=2,
        )

    @mcp.tool()
    def recommend_next_workout(days: int = 7) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        principles = load_workout_principles()
        cooldown_hours = int(principles.get("rules", {}).get("hard_muscle_cooldown_hours", 72))
        cooldown_days = max(1, cooldown_hours // 24)
        muscle_frequency_days = int(principles.get("rules", {}).get("muscle_frequency_days", 7))
        goals = principles.get("goals", [])

        events = get_recent_events(days=days, limit=200)
        workouts = [e for e in events if e["event_type"] == "workout"]
        stressors = [e for e in events if e["event_type"] == "stressor"]
        recoveries = [e for e in events if e["event_type"] == "recovery"]

        lower_groups = {"quads", "hamstrings", "glutes", "calves"}
        upper_groups = {"chest", "back", "lats", "traps", "shoulders", "biceps", "triceps", "forearms"}
        major_groups = {
            "chest",
            "back",
            "shoulders",
            "biceps",
            "triceps",
            "core",
            "glutes",
            "quads",
            "hamstrings",
            "calves",
        }

        lower_load = 0
        upper_load = 0
        ran_recently = False
        core_sessions = 0
        cardio_sessions = 0
        last_hard_by_muscle: dict[str, int] = {}
        last_hit_by_muscle: dict[str, int] = {}
        for w in workouts[:8]:
            payload = w.get("payload", {})
            groups = set(payload.get("muscle_groups", []))
            modalities = set(payload.get("modalities", []))
            intensity = payload.get("intensity", "unknown")
            age_days = _days_ago(str(w.get("entry_date", "")))
            weight = 2 if intensity == "high" else 1
            if groups & lower_groups:
                lower_load += weight
            if groups & upper_groups:
                upper_load += weight
            if "running" in modalities:
                ran_recently = True
            if "core" in groups:
                core_sessions += 1
            if "running" in modalities or "cycling" in modalities or "swimming" in modalities or "walking" in modalities:
                cardio_sessions += 1

            for m in groups & major_groups:
                prev = last_hit_by_muscle.get(m)
                if prev is None or age_days < prev:
                    last_hit_by_muscle[m] = age_days
                if intensity == "high":
                    prev_h = last_hard_by_muscle.get(m)
                    if prev_h is None or age_days < prev_h:
                        last_hard_by_muscle[m] = age_days

        high_stress = any(_is_high_stress(s.get("payload", {})) for s in stressors[:5])
        low_recovery = any(_is_low_recovery(r.get("payload", {})) for r in recoveries[:5])
        whoop_signals = None
        whoop_error = None
        try:
            whoop_signals = get_whoop_multi_window_signals()
        except Exception as exc:
            whoop_error = str(exc)

        recommendation = "balanced full body, moderate intensity"
        rationale: list[str] = []
        avoid_muscles = sorted([m for m, age in last_hard_by_muscle.items() if age < cooldown_days])
        undertrained = sorted([m for m in major_groups if last_hit_by_muscle.get(m, 999) >= muscle_frequency_days])

        w7 = (whoop_signals or {}).get("last_7d", {})
        w3 = (whoop_signals or {}).get("last_3d", {})
        wy = (whoop_signals or {}).get("yesterday", {})

        whoop_low_recovery = bool(
            w7.get("low_recovery_signal") or w3.get("low_recovery_signal") or wy.get("low_recovery_signal")
        )
        whoop_sleep_debt = bool(
            w7.get("sleep_debt_signal") or w3.get("sleep_debt_signal") or wy.get("sleep_debt_signal")
        )
        whoop_high_strain = bool(w7.get("high_strain_signal") or w3.get("high_strain_signal"))
        yesterday_guard = bool(wy.get("low_recovery_signal") or wy.get("sleep_debt_signal"))

        if high_stress or low_recovery or whoop_low_recovery or whoop_sleep_debt or yesterday_guard:
            recommendation = "recovery day or easy zone-2 cardio + mobility"
            rationale.append("Recent stress/recovery signals suggest lowering intensity.")
            if yesterday_guard:
                rationale.append("Yesterday's Whoop recovery/sleep was poor; avoid hard training today.")
            elif whoop_low_recovery or whoop_sleep_debt:
                rationale.append("Whoop short-term recovery/sleep trends indicate elevated fatigue.")
        elif lower_load >= upper_load + 2:
            recommendation = "upper-body focused strength session (moderate)"
            rationale.append("Recent training load is biased toward lower body.")
        elif upper_load >= lower_load + 2:
            recommendation = "lower-body focused session (moderate)"
            rationale.append("Recent training load is biased toward upper body.")
        else:
            rationale.append("Recent upper/lower load appears relatively balanced.")

        if ran_recently and recommendation != "recovery day or easy zone-2 cardio + mobility":
            rationale.append("Recent running load detected; avoid stacking hard running back-to-back.")
        if whoop_high_strain and recommendation != "recovery day or easy zone-2 cardio + mobility":
            rationale.append("Whoop 7-day strain load is elevated; keep intensity controlled.")
        if avoid_muscles:
            rationale.append(f"Avoid hard work for recently hit muscles (<{cooldown_hours}h): {', '.join(avoid_muscles)}.")
        if undertrained:
            rationale.append(f"Undertrained this week (>{muscle_frequency_days} days): {', '.join(undertrained[:4])}.")
        if "heart_health" in goals and cardio_sessions < int(principles.get("focus", {}).get("cardio_sessions_per_week_target", 3)):
            rationale.append("Heart health goal active: add easy zone-2 cardio if recovery allows.")
        if "visible_abs" in goals and core_sessions < int(principles.get("focus", {}).get("core_sessions_per_week_target", 3)):
            rationale.append("Visible abs goal active: add brief core block (10-15 min).")

        fallback_recommendation = recommendation
        fallback_rationale = rationale.copy()

        llm_context = {
            "goals": goals,
            "principles": principles,
            "derived_signals": {
                "lower_load": lower_load,
                "upper_load": upper_load,
                "ran_recently": ran_recently,
                "high_stress": high_stress,
                "low_recovery": low_recovery,
                "whoop_low_recovery": whoop_low_recovery,
                "whoop_sleep_debt": whoop_sleep_debt,
                "whoop_high_strain": whoop_high_strain,
                "yesterday_guard": yesterday_guard,
                "avoid_muscles": avoid_muscles,
                "undertrained": undertrained,
                "core_sessions_7d": core_sessions,
                "cardio_sessions_7d": cardio_sessions,
            },
            "whoop": whoop_signals,
            "recent_workouts": workouts[:6],
            "recent_stressors": stressors[:4],
            "recent_recoveries": recoveries[:4],
        }
        llm_out, llm_error = _llm_synthesize_recommendation(
            context=llm_context,
            fallback_recommendation=fallback_recommendation,
            fallback_rationale=fallback_rationale,
        )

        recommendation_source = "rules_fallback"
        llm_cautions: list[str] = []
        llm_confidence: float | None = None
        if llm_out:
            recommendation = llm_out.get("recommendation", recommendation)
            rationale = llm_out.get("rationale", rationale)
            llm_cautions = llm_out.get("cautions", [])
            llm_confidence = llm_out.get("confidence")
            recommendation_source = "llm"

        return json.dumps(
            {
                "recommendation": recommendation,
                "recommendation_source": recommendation_source,
                "goals": goals,
                "signals": {
                    "lower_load": lower_load,
                    "upper_load": upper_load,
                    "ran_recently": ran_recently,
                    "high_stress": high_stress,
                    "low_recovery": low_recovery,
                    "avoid_muscles": avoid_muscles,
                    "undertrained": undertrained,
                    "core_sessions_7d": core_sessions,
                    "cardio_sessions_7d": cardio_sessions,
                    "whoop": whoop_signals,
                    "yesterday_guard": yesterday_guard,
                },
                "rationale": rationale,
                "cautions": llm_cautions,
                "llm_confidence": llm_confidence,
                "whoop_error": whoop_error,
                "llm_error": llm_error,
            },
            indent=2,
        )

    @mcp.tool()
    def submit_recommendation_feedback(
        recommendation: str,
        helpful: bool,
        note: Optional[str] = None,
        context_entry_id: Optional[int] = None,
    ) -> str:
        ok, err = _ensure_journal_db()
        if not ok:
            return json.dumps({"error": err}, indent=2)
        context = {
            "context_entry_id": context_entry_id,
            "submitted_at": datetime.utcnow().isoformat(),
        }
        row = save_recommendation_feedback(
            recommendation=recommendation,
            helpful=helpful,
            note=note,
            context=context,
        )
        return json.dumps({"saved": row}, indent=2)
