# Roadmap to an AI-first Fitness App

## North Star
- Unified health timeline: meals, activities, sleep/recovery (e.g., Whoop) in one store.
- Conversational analytics: ask questions; system routes queries to the right data/tools and composes answers with charts.
- Extensible sources via adapters; safe, reproducible decisions with versioned prompts/policies.

## Phase 1 — Solidify the Core (now → near term)
- Data: keep SQLAlchemy models + Pydantic schemas; idempotent init (simple migrations later if needed).
- UX: Streamlit thin (UI only); push logic to service modules.
- Contracts: define read-APIs returning DataFrames for each domain (meals, activities, recovery).
- Observability: structured logs + simple query timing; capture user actions for future evals.

## Phase 2 — Multi-source Foundations (Whoop-ready)
- Source adapters: add `whoop_adapter.py` that hides auth, rate limits, pagination; outputs normalized DataFrames: sleep, recovery, strain/activity.
- Canonical schemas: minimal shared columns (timestamp, user_id, source, metric, value, tags) to enable joins across streams.
- Identity/time alignment: settle on timezone policy and day-bucketing; utilities for resampling and joins (meals → daily totals; recovery → daily score).

## Phase 3 — Analytics Services
- Domain services: `nutrition_service`, `recovery_service`, `activity_service` layering on repositories.
- Cross-domain features: meal timing vs sleep latency, carbs vs HRV/recovery, strain vs appetite.
- Caching: memoize heavy queries by (user, date-range, filters) to keep the UI snappy.

## Phase 4 — Conversational Layer (pre-MCP)
- Intent router: map natural-language intents to service functions (no tools yet): trend, compare, correlate, summarize.
- Answer composer: return text + one visualization per turn; ground on aggregated data (not raw rows).
- Guardrails: limit date ranges, enforce units, redact PII.

## Phase 5 — Introduce MCP (tooling) at the Right Time
- When: add MCP once you have 5–8 stable, reusable analytics functions across domains and feel friction scaling the router.
- Tools: expose cohesive tools (not too granular): `get_meals(start,end,filters)`, `daily_totals(...)`, `whoop_recovery(...)`, `correlate(series_a, series_b, window)`.
- Orchestrator: model selects tools, planner chains calls, validator checks outputs vs schemas; detach tool registry from UI.

## Phase 6 — Personalization and Policies
- Profiles/goals: calorie targets, macro ratios, recovery thresholds.
- Policy layer: “if recovery < x, recommend y” with human-in-the-loop confirmations.
- Programmatic actions: reminders, weekly summaries, habit nudges (opt-in).

## Cross-cutting Concerns
- Privacy: local-first by default; if cloud, encrypt at rest, secure secrets.
- Provenance: store query params and tool outputs alongside answers for reproducibility.
- Eval & QA: a small benchmark of questions + expected aggregates/charts to prevent regressions.
- Cost control: summarize before sending to LLM; prefer statistics kernels over chat when possible.

## Decision Points (checkpoints)
- MCP gate: “Do we have stable tool boundaries? Do we need multi-step plans regularly?”
- Storage gate: “Do we outgrow SQLite for joins and concurrent writes?”
- UI gate: “Do we need multi-page/navigation or move beyond Streamlit?”

## Minimal Next Steps (no code details)
- Add a Whoop adapter spike (mock or CSV) and validate normalized schemas.
- Define 6–8 analytics contracts you want to keep long-term (inputs/outputs only).
- Add a lightweight intent map (keywords→analytics call) to test conversational UX before MCP.
- Start an eval notebook with 10 canonical questions and expected aggregates.
