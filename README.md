# NutriBot

NutriBot is an MCP-based journaling intelligence assistant.

Current implementation is fitness/wellness-first and combines:
- free-form daily journaling
- structured LLM-based text parsing
- Whoop fitness tracker data
- rule-driven workout recommendations

Architecture direction is broader: capture life themes from journal entries over time, then generate feedback from those tracked patterns.

Core domains:
- nutrition
- training
- recovery/sleep
- stress/mood

## Core Stack

- OpenAI API for chat completions and structured journal parsing (gpt-4o-mini)
- Custom MCP server (`FastMCP`) exposing domain tools
- Custom chat runtime with ReAct-style tool-call loop (reason -> call tool -> observe -> continue)
- Async background parsing pipeline for non-blocking journal ingestion
- PostgreSQL + SQLAlchemy for persistence (`journal_entries`, `journal_events`, feedback)
- Whoop SDK integration for recovery/sleep/workout trend signals
- Pydantic schema validation for parsed events and payload integrity

## What It Does (Current)

- Captures daily free-form journal entries and persists them.
- Parses entries asynchronously into typed events (`meal`, `workout`, `recovery`, `stressor`, `other`) with schema validation.
- Produces workout recommendations from principles, parsed journal history, and Whoop short-term trends (`last_7d`, `last_3d`, `yesterday`).
- Synthesizes recommendations with an LLM from structured training, recovery, stress, and Whoop signals.
- Captures recommendation feedback for iterative tuning.

## Product Direction

- Keep journaling input broad and natural.
- Extract structured themes over time, centered on the core domains above.
- Extend with additional life context (for example: routines, work, relationships) as secondary layers.
- Use longitudinal patterns to generate practical feedback across life domains.
- Maintain clear safety boundaries for mental-health-adjacent support (reflection/pattern support, not diagnosis).

## Execution Flow

1. User writes a free-form journal entry.
2. Entry is saved immediately and marked for async parsing.
3. Background LLM parse converts text into validated typed events.
4. Recommendation engine combines:
   - workout principles config (`mcp_server/config/workout_principles.json`)
   - recent journal events
   - Whoop trend windows (`last_7d`, `last_3d`, `yesterday`)
   - LLM synthesis for final recommendation text/rationale
   - fallback rules only if LLM synthesis fails
5. User feedback on recommendations is stored for future tuning.

## In-Action Examples

### 1) Save and parse a mixed entry
Prompt:
```
Breakfast was eggs and fruit. Lunch was salmon and rice. I did hard legs (quads, hamstrings, glutes) and then a short run. Stress is high from work and I slept badly.
```

Parsed output (example):
```json
[
  {
    "event_type": "meal",
    "confidence": 0.90,
    "payload": {
      "foods": ["eggs", "fruit"],
      "summary": "Breakfast with eggs and fruit."
    }
  },
  {
    "event_type": "meal",
    "confidence": 0.90,
    "payload": {
      "foods": ["salmon", "rice"],
      "summary": "Lunch with salmon and rice."
    }
  },
  {
    "event_type": "workout",
    "confidence": 0.90,
    "payload": {
      "modalities": ["strength", "running"],
      "muscle_groups": ["quads", "hamstrings", "glutes", "cardio"],
      "intensity": "high",
      "summary": "Hard lower-body session followed by a short run."
    }
  },
  {
    "event_type": "stressor",
    "confidence": 0.80,
    "payload": {
      "stress_level": "high",
      "stress_source": "work"
    }
  },
  {
    "event_type": "recovery",
    "confidence": 0.70,
    "payload": {
      "sleep_notes": "Slept badly last night.",
      "soreness_areas": []
    }
  }
]
```

### 2) Generate a recommendation
Prompt:
```
Given my recent week, what should my next workout be and why?
```

Tool-call trace (example):
```text
tool: get_workout_principles()
result: { rules: { muscle_frequency_days: 7, hard_muscle_cooldown_hours: 72, ... } }

tool: get_recent_journal(days=7, limit=20)
result: entries=[entry_id=6, entry_id=5, entry_id=4]

tool: get_journal_events(entry_id=6)
result: 5 events
  - meal (eggs, fruit) confidence=0.9
  - meal (salmon, rice) confidence=0.9
  - workout (strength + running; quads/hamstrings/glutes/cardio; intensity=high) confidence=0.9
  - stressor (high, source=work) confidence=0.8
  - recovery (sleep_notes=\"Slept badly last night.\") confidence=0.7

tool: recommend_next_workout(days=7)
result:
  recommendation=\"recovery day or easy zone-2 cardio + mobility\"
  recommendation_source=\"llm\"
  signals.lower_load=7, signals.upper_load=4
  signals.high_stress=true, signals.low_recovery=true
  signals.whoop.last_7d.total_workout_strain=67.81
  signals.whoop.last_3d.avg_recovery_score=63.67
  signals.whoop.yesterday.latest_recovery_score=79.0
  signals.yesterday_guard=false
```

Example output (shape):
```json
{
  "recommendation": "recovery day or easy zone-2 cardio + mobility",
  "recommendation_source": "llm",
  "goals": ["heart_health", "muscle_gain", "visible_abs"],
  "signals": {
    "lower_load": 7,
    "upper_load": 4,
    "high_stress": true,
    "low_recovery": true,
    "yesterday_guard": false,
    "whoop": {
      "last_7d": {
        "avg_recovery_score": 61.86,
        "avg_sleep_performance": 87.0,
        "total_workout_strain": 67.81
      },
      "last_3d": {
        "avg_recovery_score": 63.67,
        "avg_sleep_performance": 90.0
      },
      "yesterday": {
        "latest_recovery_score": 79.0,
        "latest_sleep_performance": 96.0
      }
    }
  },
  "rationale": [
    "Recent stress/recovery signals suggest lowering intensity.",
    "Avoid hard work for recently hit muscles (<72h): biceps, chest, core, glutes, hamstrings, quads, shoulders, triceps.",
    "Undertrained this week (>7 days): back, calves.",
    "Visible abs goal active: add brief core block (10-15 min)."
  ]
}
```

### 3) Submit feedback
Prompt:
```
That recommendation was very aligned with how I feel today.
```

Expected result: feedback is captured and persisted with context for future tuning.

## MCP Tools

### Date/Time Context
Provides reliable current-date context so relative references like \"today\" and \"yesterday\" are resolved consistently.

### Whoop Integration
Pulls profile, recovery, sleep, and workout data to generate short-term trend signals (`last_7d`, `last_3d`, `yesterday`) used in recommendation decisions.

### Journal Ingestion and Parsing
Accepts free-form daily logs, persists raw entries, runs asynchronous LLM parsing, and stores structured event data (`meal`, `workout`, `recovery`, `stressor`, `other`).

### Retrieval and Quality Ops
Supports recent/history retrieval, keyword search, and repair flows (for example, reparsing legacy entries with empty payloads).

### Recommendation and Feedback Loop
Generates next-workout recommendations from principles + journal signals + Whoop trends, then captures user feedback for iterative tuning.


## Project Structure

```text
nutribot/
├── chat.py
├── chat_client/
├── logs/
├── mcp_server/
│   ├── config/
│   │   └── workout_principles.json
│   ├── tools/
│   │   ├── journal_tools.py
│   │   └── whoop_tools.py
│   ├── db.py
│   ├── journal_parser.py
│   ├── server.py
│   └── workout_principles.py
└── pyproject.toml
```

## Setup

### Prereqs
- Python 3.13+
- `uv`
- OpenAI API key
- Whoop credentials
- Postgres database URL

### Environment

Create `.env` in repo root:

```bash
OPENAI_API_KEY=...
DATABASE_URL=postgresql://...
WHOOP_EMAIL=...
WHOOP_PASSWORD=...
```

### Run

```bash
uv sync
uv run python chat.py
```

## Design Notes

- `workout_principles.json` is the single source of truth for goals/rules.
- Parser payloads are strictly validated by event type.
- Journal parse is asynchronous by design to keep interaction responsive.

## TODO (Single Source of Truth)

### Completed

- [x] Keep lazy Whoop auth in place (`whoop.login()` no longer runs on import).
- [x] Add journal persistence layer:
  - `journal_entries`: `id`, `entry_date`, `raw_text`, `parse_status`, `parse_error`, `created_at`, `updated_at`
  - `journal_events`: `id`, `entry_id`, `event_type`, `payload_json`, `confidence`, `created_at`
- [x] Add MCP journal tools:
  - `save_journal_entry(content, entry_date?)`
  - `get_journal_parse_status(entry_id)`
  - `get_recent_journal(days=7, limit=20)`
  - `search_journal(query, limit=10)` (Postgres full-text search)
- [x] Add async LLM parse pipeline:
  - Background parse after save (`queued` -> `processing` -> `success|failed`)
  - Parse freeform into events: `meal`, `workout`, `recovery`, `stressor`, `other`
  - Validate JSON shape before writing events
- [x] Define constrained enums for consistency:
  - Muscle groups: `chest`, `back`, `lats`, `traps`, `shoulders`, `biceps`, `triceps`, `forearms`, `core`, `glutes`, `quads`, `hamstrings`, `calves`, `full_body`, `cardio`
  - Training modalities: `strength`, `running`, `cycling`, `swimming`, `walking`, `sports`, `mobility`, `other`
- [x] Add recommendation tool: `recommend_next_workout(days=7)`.

### Next
- [ ] P0: Add phone-first journaling ingestion (lowest-friction capture) via Notion or another API-backed app.
- [ ] Add Question Mode for proactive check-ins.
  - Detect trend patterns (for example, dipping recovery + rising stress)
  - Ask one focused follow-up question to gather missing context
  - Store responses as structured context for future recommendations
- [ ] Link parsed workout events to Whoop workout events.
  - Match by date/time windows and modality
  - Store linkage fields (for example, `whoop_workout_id`, `match_confidence`)
  - Use Whoop metrics (strain/recovery/sleep) to improve recommendations
- [ ] Hybrid journal search:
  - Keep Postgres full-text search
  - Add semantic vector search and combine ranks
- [ ] Add recommendation feedback analytics.
- [ ] Add Whoop-to-journal event linking with confidence scoring.
- [ ] Add macronutrient estimates from logged meals (daily + per-meal rollups).
- [ ] Add meal recommendations based on goals, training load, and recent recovery trends.
- [ ] Add HTTP/SSE MCP transport + auth for remote deployment.
