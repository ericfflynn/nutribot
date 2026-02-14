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
        payload = event.payload
        if event.event_type == "workout":
            payload = WorkoutPayload.model_validate(payload).model_dump()
        elif event.event_type == "recovery":
            payload = RecoveryPayload.model_validate(payload).model_dump(exclude_none=True)
        elif event.event_type == "meal":
            payload = MealPayload.model_validate(payload).model_dump(exclude_none=True)
        elif event.event_type == "stressor":
            payload = StressorPayload.model_validate(payload).model_dump(exclude_none=True)
        else:
            payload = OtherPayload.model_validate(payload).model_dump()

        out.append(
            {
                "event_type": event.event_type,
                "confidence": event.confidence,
                "payload": payload,
            }
        )
    return out
