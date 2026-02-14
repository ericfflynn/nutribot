# TODO

## Current Plan (MVP First)

1. Keep lazy Whoop auth in place (done)
- `whoop.login()` no longer runs on import.

2. Add journal persistence layer
- `journal_entries`: `id`, `entry_date`, `raw_text`, `parse_status`, `parse_error`, `created_at`, `updated_at`
- `journal_events`: `id`, `entry_id`, `event_type`, `payload_json`, `confidence`, `created_at`

3. Add MCP journal tools
- `save_journal_entry(content, entry_date?)` -> saves immediately with `parse_status=queued`
- `get_journal_parse_status(entry_id)`
- `get_recent_journal(days=7, limit=20)`
- `search_journal(query, limit=10)` (Postgres full-text search)

4. Add async LLM parse pipeline
- Background parse after save (`queued` -> `processing` -> `success|failed`)
- Parse freeform into events: `meal`, `workout`, `recovery`, `stressor`, `other`
- Validate JSON shape before writing events

5. Define constrained enums for consistency
- Muscle groups: `chest`, `back`, `lats`, `traps`, `shoulders`, `biceps`, `triceps`, `forearms`, `core`, `glutes`, `quads`, `hamstrings`, `calves`, `full_body`, `cardio`
- Training modalities: `strength`, `running`, `cycling`, `swimming`, `walking`, `sports`, `mobility`, `other`

6. Add a simple recommendation tool
- `recommend_next_workout(days=7)` using recent parsed events + simple rules + macro workout principles (I will define)

## Next Iteration

1. Link parsed workout events to Whoop workout events
- Match by date/time windows and modality
- Store linkage fields (e.g., `whoop_workout_id`, `match_confidence`)
- Use Whoop metrics (strain/recovery/sleep) to improve recommendations

2. Hybrid journal search
- Keep Postgres full-text search
- Add semantic vector search later and combine ranks
