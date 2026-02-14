"""Whoop-related MCP tools."""

import json
from datetime import date, datetime, timedelta
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP
from whoop_sdk import Whoop

_whoop: Optional[Whoop] = None


def _get_whoop_client() -> Whoop:
    global _whoop
    if _whoop is None:
        client = Whoop()
        client.login()
        _whoop = client
    return _whoop


def _convert_date_to_iso(date_str: Optional[str], is_end_date: bool = False) -> Optional[str]:
    if not date_str:
        return None
    try:
        d = date.fromisoformat(date_str)
        if is_end_date:
            dt = datetime.combine(d, datetime.max.time())
            return dt.strftime("%Y-%m-%dT23:59:59.999Z")
        dt = datetime.combine(d, datetime.min.time())
        return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    except ValueError:
        return date_str


def _records(data: Any) -> list[dict]:
    if isinstance(data, dict):
        recs = data.get("records", [])
        return recs if isinstance(recs, list) else []
    if isinstance(data, list):
        return data
    return []


def _dig(obj: Any, *paths: str) -> Optional[float]:
    for path in paths:
        cur = obj
        ok = True
        for part in path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                ok = False
                break
        if ok:
            try:
                return float(cur)
            except (TypeError, ValueError):
                continue
    return None


def _avg(values: list[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def _get_whoop_window_signals(days: int, end_offset_days: int = 0) -> dict[str, Any]:
    """Compute Whoop trend signals for a specific window ending `end_offset_days` ago."""
    end_day = date.today() - timedelta(days=max(end_offset_days, 0))
    start_day = end_day - timedelta(days=max(days - 1, 0))
    start_iso = _convert_date_to_iso(start_day.isoformat(), is_end_date=False)
    end_iso = _convert_date_to_iso(end_day.isoformat(), is_end_date=True)

    recovery_raw = _get_whoop_client().get_recovery(start=start_iso, end=end_iso, max_pages=3)
    sleep_raw = _get_whoop_client().get_sleep(start=start_iso, end=end_iso, max_pages=3)
    workout_raw = _get_whoop_client().get_workouts(start=start_iso, end=end_iso, max_pages=3)

    recovery_scores = [
        x
        for x in [
            _dig(r, "score.recovery_score", "recovery_score", "recovery")
            for r in _records(recovery_raw)
        ]
        if x is not None
    ]
    sleep_perf = [
        x
        for x in [
            _dig(r, "score.sleep_performance_percentage", "sleep_performance_percentage", "sleep_performance")
            for r in _records(sleep_raw)
        ]
        if x is not None
    ]
    workout_strain = [
        x
        for x in [
            _dig(r, "score.strain", "strain", "score.kilojoule")
            for r in _records(workout_raw)
        ]
        if x is not None
    ]

    avg_recovery = _avg(recovery_scores)
    avg_sleep = _avg(sleep_perf)
    total_strain = sum(workout_strain) if workout_strain else 0.0
    latest_recovery = recovery_scores[0] if recovery_scores else None
    latest_sleep = sleep_perf[0] if sleep_perf else None

    recent_recovery_avg = _avg(recovery_scores[:3]) if recovery_scores else None
    prior_recovery_avg = _avg(recovery_scores[3:6]) if len(recovery_scores) >= 6 else None
    recovery_trend = None
    if recent_recovery_avg is not None and prior_recovery_avg is not None:
        recovery_trend = recent_recovery_avg - prior_recovery_avg

    signals = {
        "window_days": days,
        "end_offset_days": end_offset_days,
        "avg_recovery_score": avg_recovery,
        "latest_recovery_score": latest_recovery,
        "avg_sleep_performance": avg_sleep,
        "latest_sleep_performance": latest_sleep,
        "workout_count": len(workout_strain),
        "total_workout_strain": round(total_strain, 2),
        "avg_workout_strain": round(_avg(workout_strain) or 0.0, 2),
        "recovery_trend_delta": round(recovery_trend, 2) if recovery_trend is not None else None,
    }
    signals["low_recovery_signal"] = bool(
        (avg_recovery is not None and avg_recovery < 45)
        or (latest_recovery is not None and latest_recovery < 40)
        or (recovery_trend is not None and recovery_trend < -8)
    )
    signals["sleep_debt_signal"] = bool(
        (avg_sleep is not None and avg_sleep < 70)
        or (latest_sleep is not None and latest_sleep < 65)
    )
    signals["high_strain_signal"] = bool(total_strain >= 65)
    return signals


def get_whoop_multi_window_signals() -> dict[str, Any]:
    """Return short-term trend windows for recommendation logic."""
    return {
        "last_7d": _get_whoop_window_signals(days=7, end_offset_days=0),
        "last_3d": _get_whoop_window_signals(days=3, end_offset_days=0),
        "yesterday": _get_whoop_window_signals(days=1, end_offset_days=1),
    }


def register_whoop_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_current_date() -> str:
        return date.today().isoformat()

    @mcp.tool()
    def get_whoop_profile() -> str:
        try:
            profile = _get_whoop_client().get_profile()
            return json.dumps(profile, indent=2, default=str)
        except Exception as exc:
            return json.dumps({"error": str(exc)}, indent=2)

    @mcp.tool()
    def get_whoop_recovery(
        start: Optional[str] = None,
        end: Optional[str] = None,
        limit: Optional[int] = None,
        max_pages: Optional[int] = 3,
    ) -> str:
        try:
            recovery = _get_whoop_client().get_recovery(
                limit=limit,
                start=_convert_date_to_iso(start, is_end_date=False),
                end=_convert_date_to_iso(end, is_end_date=True),
                max_pages=max_pages,
            )
            return json.dumps(recovery, indent=2, default=str)
        except ValueError as exc:
            return json.dumps({"error": f"Invalid date format. Use YYYY-MM-DD or ISO format: {exc}"}, indent=2)
        except Exception as exc:
            return json.dumps({"error": str(exc)}, indent=2)

    @mcp.tool()
    def get_whoop_sleep(
        start: Optional[str] = None,
        end: Optional[str] = None,
        limit: Optional[int] = None,
        max_pages: Optional[int] = 3,
    ) -> str:
        try:
            sleep = _get_whoop_client().get_sleep(
                limit=limit,
                start=_convert_date_to_iso(start, is_end_date=False),
                end=_convert_date_to_iso(end, is_end_date=True),
                max_pages=max_pages,
            )
            return json.dumps(sleep, indent=2, default=str)
        except ValueError as exc:
            return json.dumps({"error": f"Invalid date format. Use YYYY-MM-DD or ISO format: {exc}"}, indent=2)
        except Exception as exc:
            return json.dumps({"error": str(exc)}, indent=2)

    @mcp.tool()
    def get_whoop_workouts(
        start: Optional[str] = None,
        end: Optional[str] = None,
        limit: Optional[int] = None,
        max_pages: Optional[int] = 3,
    ) -> str:
        try:
            workouts = _get_whoop_client().get_workouts(
                limit=limit,
                start=_convert_date_to_iso(start, is_end_date=False),
                end=_convert_date_to_iso(end, is_end_date=True),
                max_pages=max_pages,
            )
            return json.dumps(workouts, indent=2, default=str)
        except ValueError as exc:
            return json.dumps({"error": f"Invalid date format. Use YYYY-MM-DD or ISO format: {exc}"}, indent=2)
        except Exception as exc:
            return json.dumps({"error": str(exc)}, indent=2)
