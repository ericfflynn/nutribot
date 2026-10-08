# Wellbeing POC: repository review and discussion draft

Status: proposed requirements, not an approved implementation plan. Reviewed October 1, 2026 against local commit `707bbff`. Branch: `codex/wellbeing-agent-poc`.

This document records architecture and product decisions without copying private goal text or personal experiment details into Git. The supplied working spec remains outside the repository.

## Where the project left off

- Next.js App Router, React, TypeScript, CSS, and server actions; one application, no separate backend service.
- `/` is a shared nutrition dashboard for all configured users. `/profile` contains the signed-in user's meal logger, history, date selection, and macro targets.
- Meal flow: plain text → server-side model estimate → review/correction/manual edit → explicit save. Corrections pass the previous estimate to the model; there is no persistent conversation history.
- `lib/macro-parser.ts` calls OpenAI Chat Completions with a strict JSON schema and validates with Zod. Default configured in code: `gpt-4o-mini`. Meal totals are calculated from estimated items in code.
- `lib/supabase.ts` supports direct Postgres via `pg` when `DATABASE_URL` exists, otherwise the Supabase service-role API. This is not inherently Supabase-only storage. Direct connections currently force SSL with certificate verification disabled; connection configuration needs attention before using a different database.
- `supabase/schema.sql` defines only `macro_entries` and `user_macro_goals`. Ownership uses text user names, not user UUIDs. RLS is enabled, but the schema contains no per-user policies; server queries enforce the current access behavior.
- `lib/auth.ts` implements environment-configured users/passwords and signed cookies. This is custom authentication, not Supabase Auth. The home page intentionally reads all users' summaries.
- Existing nutrition analytics average completed logged days, excluding today and unlogged days. The UI queries seven dates including today, so that view includes at most six completed dates. Do not reuse this unchanged as a general seven-day health trend.
- README documents Vercel deployment and manual schema setup. No migration runner, test suite, chat runtime, wearable integration, or background worker is present in tracked files.
- Latest commits refine meal estimates and corrections; the latest switches back to the smaller model for speed. Local ignored TODO notes mention auth hardening, mobile improvements, and richer meal editing.

The user reports the hosted database and Vercel deployment are deactivated. No remote service was contacted or reactivated. `.env.local` exists and is ignored; its contents were not read. The local TypeScript check passes (`tsc --noEmit --incremental false`). This does not establish working database, model, or deployed behavior.

## Reuse versus new work

| Phase 1 capability | Current state | Proposed bridge |
| --- | --- | --- |
| Goal | Nutrition target percentages only | New wellbeing goal model; leave macro goals separate |
| Experiment | Absent | Generic dated intervention attached to a goal |
| Persistent conversation | Absent | Owned conversations/messages with durable send status |
| Context assembly | Meal prompt plus correction only | Server-side assembly of permitted goals, selected active experiment, bounded chat history, and current local date |
| Privacy filter | Session checks and query filters | Explicit owner checks, sensitivity and provider-disclosure policy applied before prompt construction |
| Reasoning | Meal-specific structured estimation | Small separate reasoning operation using one provider initially |
| Frontend | Functional nutrition flow | Add chat and private setup, keep nutrition available pending product decision |
| Storage | Postgres or Supabase API | Choose runtime home before implementing migrations |

Proposed technical direction: keep Next.js and TypeScript. Python examples in the working spec describe concepts, not a requirement to introduce Python. Keep nutrition functionality intact initially; its eventual product prominence is undecided.

## Requirements that need tightening

1. **Runtime home:** local-only on one computer, accessible from a phone, or hosted private web app? Database and authentication choices follow this decision. Existing Postgres access offers the least storage rewrite if Postgres remains appropriate; SQLite would require adapting the existing meal repository too.
2. **Users and sharing:** single-user first or multiple private accounts? Existing shared nutrition visibility must not extend to goals, experiments, messages, or wellbeing evidence. Any future sharing needs its own explicit rule.
3. **Privacy means more than Git safety:** define which information may be sent to an external model. Sensitivity labels do not themselves grant permission. Proposed default: highly sensitive historical material is excluded unless explicitly enabled for the relevant interaction; private material requires the user's chosen provider policy. Apply the policy to chat history as well as structured records. Classification must not require sending excluded content to another model first.
4. **Phase 1 progress:** elapsed experiment days are calculable, but adherence is not known from the calendar. Phase 1 should report adherence/evidence as unavailable unless explicitly recorded. Moving adherence into Phase 1 is a scope decision.
5. **Generic versus experiment-specific schemas:** the proposed substance-specific check-in and adherence columns conflict with generic experiments. When those phases arrive, use metric definitions and intervention-keyed outcomes rather than new columns for each experiment.
6. **Daily check-in and observations:** specify one source of truth. Proposed: original check-in is the source record; derived observations link back to it and are replaced/versioned predictably on correction. Retries must not duplicate evidence.
7. **Observation semantics:** define canonical metric identifiers, units, valid ranges, event time versus recording time, timezone, daily versus event granularity, and source references. Model-reported confidence is not a calibrated probability. Missing data must remain distinct from zero.
8. **Conversation extraction:** decide whether inferred observations are saved as candidates or require review. Preserve source message and extraction version; changing/deleting source evidence must invalidate dependent observations and memories.
9. **Baseline availability:** pre-experiment data may not exist. Never invent a retrospective subjective baseline. Specify minimum coverage, displayed sample counts, missing-data handling, and zero-denominator behavior before building comparisons.
10. **Authority:** goal changes must occur through explicit user actions, enforced server-side. A model response or text claiming authority cannot mutate goals. Phase 1 reasoning needs no write tools.
11. **Durability:** define backup, restore, export, deletion, and retention expectations. Saving a database row is not a complete backup strategy.
12. **Context limits:** start with a selected active experiment, its goal ancestry, and bounded recent history. Broad automatic relevance across many domains can wait. Privacy remains mandatory at this smaller scope.

## Proposed Phase 1 acceptance requirements

- User can privately create/edit a top-level goal and one dated experiment through setup UI; no real personal seeds in code or SQL.
- A new conversation retrieves that saved state without the user repeating it, including after application restart.
- Experiment day is calculated from explicit year, dates, timezone, and current date, with defined before-start and after-end behavior.
- Chat persists messages and supports an understandable retry after model failure without duplicating a turn. Only server-controlled roles enter the model instruction hierarchy.
- Response can reference the active experiment and the user's stated values while acknowledging absent evidence. No fabricated adherence, health improvements, memories, or trends.
- Users cannot access another user's objects by changing IDs. The shared nutrition dashboard is not a wellbeing retrieval source.
- Excluded sensitive material cannot enter prompts through history, summaries, or error handling. Raw prompts/responses are not ordinary debug logs.
- A small context inspector shows included record types/IDs, selection reasons, model/prompt version, latency, usage when available, and error status without duplicating sensitive text.
- Existing meal review, correction, save, editing, and history remain available once a working database is configured.
- No observations, learned memories, strategy engine, background autonomy, or wearable integration are required to pass this milestone.

## Proposed files and database changes

Paths below are provisional and depend on runtime decisions; no application changes or migrations have been applied.

Create:

- `app/chat/page.tsx`, `app/chat/chat-panel.tsx`, `app/chat/actions.ts`: authenticated persistent chat.
- `app/setup/page.tsx`, `app/setup/actions.ts`: user-owned goal/experiment setup and provider-disclosure settings.
- `lib/wellbeing/schemas.ts`, `lib/wellbeing/repository.ts`: validated domain schemas and owner-scoped persistence.
- `lib/agent/context.ts`, `lib/agent/privacy.ts`: bounded context assembly and deterministic disclosure checks.
- `lib/llm/reason.ts`: typed reasoning input/output and one provider implementation. Keep meal parsing separate; add other providers only when needed.
- `db/migrations/001_wellbeing.sql`: additive Phase 1 schema after database choice.
- Focused tests for ownership, privacy, context/date boundaries, persistence, and retry behavior.

Modify:

- `lib/auth.ts`: stable user identity mapping and owner lookup; review signed-session lifetime and secret requirements before hosted use.
- `lib/supabase.ts`: share database connection plumbing if retaining Postgres; preserve existing meal functions.
- `app/shared-ui.tsx`, `app/layout.tsx`, `app/globals.css`: chat/setup navigation and product presentation.
- `.gitignore`, `.env.example`, `README.md`, `package.json`: runtime storage protection, synthetic configuration, setup/migrations and test command.
- `app/page.tsx` only if we choose chat as the landing experience.

Provisional schema:

| Table | Essential fields and constraints |
| --- | --- |
| `users` | UUID, unique legacy login mapping, timezone, disclosure preferences, timestamps |
| `goals` | UUID, owner UUID, optional same-owner parent, description, authority, sensitivity, status, timestamps; reject parent cycles |
| `experiments` | UUID, owner UUID, same-owner goal, name, description, hypothesis, start/end dates, intervention JSON, questions JSON, sensitivity, status, timestamps; validate dates |
| `conversations` | UUID, owner UUID, optional same-owner selected experiment, sensitivity, timestamps |
| `messages` | UUID, owned conversation, server-controlled role, original content, sensitivity, timestamp, request key, pending/completed/failed status |
| `llm_runs` | UUID, owner/conversation/request reference, operation, model, prompt version, permitted context IDs/types, usage, latency, sanitized error code; no raw prompt/response copy |

Use ownership constraints and queries together, including parent/child references. Status/authority/sensitivity values need database and application validation. Do not implement Phase 2+ tables yet. Retain the two nutrition tables; general wellbeing goals must not replace macro targets.

Migration sequence:

1. Decide fresh start versus recovery of previous nutrition records. Do not assume deactivation preserved an accessible backup.
2. Provision the chosen private runtime store; review the concrete SQL before execution.
3. Create additive tables and stable account mappings. Retain legacy meal ownership initially; if existing data is imported, validate account mapping and row counts without displaying private rows.
4. Add setup UI for actual personal values. Fixtures contain synthetic users, goals, and experiments only.
5. Verify owner isolation and persistence using synthetic records, then exercise the existing nutrition flow.
6. Add ignored runtime/export/database paths appropriate to the selected backend and a tracked-file guard. Existing ignores cover `.env.local` and one named database, not arbitrary database/export files. Existing screenshots need privacy review before broader publication.

Verification plan: deterministic context tests using a fake model, cross-account read/write tests, sensitive-history exclusion tests, restart/reload persistence, duplicate-send/failure retry tests, date boundary cases, and a small manual live-model acceptance check after configuration. Evaluate contextual grounding separately from exact response wording. Run type check/build and a nutrition regression smoke test after implementation.

## First discussion decisions

Start with where the app should be usable, whether nutrition remains prominent, and whether one or multiple users are in scope. Next settle model disclosure rules and whether the first useful milestone needs structured daily evidence. These decisions will make the detailed build plan concrete without committing to all later phases.
