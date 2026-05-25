"""LLM-backed journal parser with strict schema validation."""

import json
from typing import Any, Literal

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field

MUSCLE_GROUPS = [
    "chest",
    "back",
    "lats",
    "traps",
    "shoulders",
    "biceps",
    "triceps",
    "forearms",
    "core",
    "glutes",
    "quads",
    "hamstrings",
    "calves",
    "full_body",
    "cardio",
]

TRAINING_MODALITIES = [
    "strength",
    "running",
    "cycling",
    "swimming",
    "walking",
    "sports",
    "mobility",
    "other",
]

EVENT_TYPES = ["meal", "workout", "recovery", "stressor", "other"]


class ParsedJournalEvent(BaseModel):
    event_type: Literal["meal", "workout", "recovery", "stressor", "other"]
    confidence: float = Field(ge=0.0, le=1.0)
    payload: dict[str, Any]


class ParsedJournalResponse(BaseModel):
    events: list[ParsedJournalEvent] = Field(min_length=1)


class WorkoutPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    modalities: list[Literal["strength", "running", "cycling", "swimming", "walking", "sports", "mobility", "other"]]
    muscle_groups: list[
        Literal[
            "chest",
            "back",
            "lats",
            "traps",
            "shoulders",
            "biceps",
            "triceps",
            "forearms",
            "core",
            "glutes",
            "quads",
            "hamstrings",
            "calves",
            "full_body",
            "cardio",
        ]
    ]
    intensity: Literal["low", "moderate", "high", "unknown"]
    summary: str


class RecoveryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    soreness_areas: list[str] = Field(default_factory=list)
    energy: str | None = None
    sleep_notes: str | None = None
    summary: str | None = None


class MealPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    foods: list[str] = Field(default_factory=list)
    meal_summary: str | None = None
    summary: str | None = None


class StressorPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stress_level: Literal["low", "moderate", "high", "unknown"] | None = None
    stress_source: str | None = None
    summary: str | None = None


class OtherPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str


def _normalize_stress_level(value: Any) -> str:
    s = str(value or "").strip().lower()
    if s in {"low", "moderate", "high", "unknown"}:
        return s
    if s == "medium":
        return "moderate"
    return "unknown"


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value == ""
    if isinstance(value, list):
        return len(value) == 0
    return False


def _coerce_payload(event_type: str, payload: Any) -> dict[str, Any]:
    src = payload if isinstance(payload, dict) else {}
    if event_type == "workout":
        raw_modalities = src.get("modalities", [])
        raw_muscles = src.get("muscle_groups", [])
        modalities = [str(x).strip().lower() for x in raw_modalities if str(x).strip().lower() in TRAINING_MODALITIES]
        muscle_groups = [str(x).strip().lower() for x in raw_muscles if str(x).strip().lower() in MUSCLE_GROUPS]
        intensity = str(src.get("intensity", "unknown")).strip().lower()
        if intensity not in {"low", "moderate", "high", "unknown"}:
            intensity = "unknown"
        summary = str(src.get("summary") or "Workout noted.")
        return {
            "modalities": modalities or ["other"],
            "muscle_groups": muscle_groups or ["full_body"],
            "intensity": intensity,
            "summary": summary,
        }
    if event_type == "recovery":
        soreness = src.get("soreness_areas", [])
        if not isinstance(soreness, list):
            soreness = []
        out = {
            "soreness_areas": [str(x) for x in soreness if str(x).strip()],
            "energy": str(src.get("energy")).strip() if src.get("energy") is not None else None,
            "sleep_notes": str(src.get("sleep_notes")).strip() if src.get("sleep_notes") is not None else None,
            "summary": str(src.get("summary")).strip() if src.get("summary") is not None else None,
        }
        return {k: v for k, v in out.items() if not _is_blank(v)}
    if event_type == "meal":
        foods = src.get("foods", [])
        if not isinstance(foods, list):
            foods = []
        out = {
            "foods": [str(x) for x in foods if str(x).strip()],
            "meal_summary": str(src.get("meal_summary")).strip() if src.get("meal_summary") is not None else None,
            "summary": str(src.get("summary")).strip() if src.get("summary") is not None else None,
        }
        return {k: v for k, v in out.items() if not _is_blank(v)}
    if event_type == "stressor":
        out = {
            "stress_level": _normalize_stress_level(src.get("stress_level")),
            "stress_source": str(src.get("stress_source")).strip() if src.get("stress_source") is not None else None,
            "summary": str(src.get("summary")).strip() if src.get("summary") is not None else None,
        }
        return {k: v for k, v in out.items() if not _is_blank(v)}
    return {"summary": str(src.get("summary") or "General note.")}


def build_journal_parse_prompt(raw_text: str) -> str:
    return f"""
You are an extraction engine for a fitness/wellness journal.
Extract one or more events from the entry and return STRICT JSON.

Rules:
- Output format: {{"events":[...]}}
- event_type must be one of: {EVENT_TYPES}
- confidence is REQUIRED for every event and must be a float in [0.0, 1.0].
- workout payload should include:
  - modalities: array from {TRAINING_MODALITIES}
  - muscle_groups: array from {MUSCLE_GROUPS}
  - intensity: one of ["low","moderate","high","unknown"]
  - summary: short string
- recovery payload may include soreness areas, energy, sleep notes.
- stressor payload may include stress level and stress source.
- meal payload may include foods and meal summary.
- If uncertain, use event_type "other" with a low confidence score.
- Do not include markdown or extra keys outside JSON.

Journal entry:
{raw_text}
"""


def parse_journal_events(client: OpenAI, model: str, raw_text: str) -> list[dict[str, Any]]:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Return only valid JSON. No markdown."},
            {"role": "user", "content": build_journal_parse_prompt(raw_text)},
        ],
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    parsed = ParsedJournalResponse.model_validate(json.loads(content))
    out: list[dict[str, Any]] = []
    for event in parsed.events:
        payload = _coerce_payload(event.event_type, event.payload)
        if event.event_type == "workout":
            payload = WorkoutPayload.model_validate(payload).model_dump()
        elif event.event_type == "recovery":
            payload = RecoveryPayload.model_validate(payload).model_dump(exclude_none=True)
        elif event.event_type == "meal":
            payload = MealPayload.model_validate(payload).model_dump(exclude_none=True)
        elif event.event_type == "stressor":
            payload = StressorPayload.model_validate(payload).model_dump(exclude_none=True)
        else:
            try:
                payload = OtherPayload.model_validate(payload).model_dump()
            except Exception:
                payload = {"summary": "General note."}

        out.append(
            {
                "event_type": event.event_type,
                "confidence": event.confidence,
                "payload": payload,
            }
        )
    return out
