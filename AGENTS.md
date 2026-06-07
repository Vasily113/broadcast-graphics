# Broadcast Graphics Team And Agent Rules

This project is an MVP. The priority is working product behavior for demo:
template editor, templates DB, rundowns, control panel, browser renderer, uploads,
settings/channels, and best-effort DeckLink compatibility.

Do not add production-only complexity unless the team lead explicitly asks for it:
no auth, no complex database migration, no large deployment platform.

## Current Team Roles

### Sergey: Template Editor

Primary ownership:

- `frontend/src/features/editor/**`
- `frontend/src/pages/EditorPage.tsx`
- editor UI, layers, properties, variables, timeline UI, canvas interactions

Ask before changing:

- `shared/**`
- `frontend/src/core/renderer.ts`
- `frontend/src/core/timeline.ts`
- backend routes/services
- `decklink-out/**`

### Vasily: Templates, Rundowns, External Integrations

Primary ownership:

- `frontend/src/features/templates/**`
- `frontend/src/features/rundowns/**`
- `frontend/src/features/control/**`
- `frontend/src/pages/TemplatesPage.tsx`
- `frontend/src/pages/ControlPage.tsx` only for templates/rundowns/control UI
- `backend/src/routes/templates.ts`
- `backend/src/routes/rundowns.ts`
- `backend/src/routes/channels.ts`
- `backend/src/services/templates/**`
- `backend/src/services/rundowns/**`
- `backend/src/integrations/**`

Ask before changing:

- editor internals
- renderer/timeline engine
- LLM pipeline
- `decklink-out/**`

### Team Lead: Architecture, Backend Core, Shared Contracts, LLM

Primary ownership:

- `backend/src/index.ts`
- `backend/src/ws/**`
- `backend/src/services/llm/**`
- `backend/src/routes/llm.ts`
- `shared/**`
- repo scripts and workflow files
- `.cursor/rules/**`
- `AGENTS.md`
- GitHub Actions and PR process

## Agent Behavior Rules

- Start by reading the relevant files before editing.
- Keep changes inside the requested product zone.
- If a task requires files outside the zone, stop and explain why before editing.
- Do not silently change shared schemas or API/WS protocol.
- Do not mix refactor and feature work unless the user explicitly asks for a foundation refactor.
- Do not commit or push unless explicitly asked.
- Do not edit the plan file unless explicitly asked.
- Preserve the baseline behavior from `docs/baseline-checklist.md`.

## Git Workflow

- `MVP` is the protected integration branch.
- Work in feature branches:
  - `feature/sergey/<task>`
  - `feature/vasily/<task>`
  - `feature/lead/<task>`
  - `fix/<owner>/<task>`
  - `foundation/lead/<task>`
- Every change goes through PR.
- Team lead reviews every PR.
- Prefer squash merge.

## Required Local Checks

Before opening or merging a PR:

```bash
npm install
npm run typecheck
npm run build
./start.sh
```

For foundation-level changes, also run the manual scenarios in:

```bash
docs/baseline-checklist.md
```

## Shared Contracts

Shared contracts live in `shared/src/**`.

Use them for:

- template schema
- timeline schema
- rundown schema
- channel schema
- control WebSocket protocol
- LLM request/response schema

Changing a shared contract requires an explicit note in the PR:

- what changed;
- which frontend/backend/renderer code was affected;
- whether `data/db.json` can be reset;
- which baseline scenarios were checked.

## MVP Constraints

Allowed for MVP:

- lowdb JSON storage;
- open local/network access without auth;
- manual baseline checks;
- local llama.cpp server;
- simple fallback behavior if LLM is unavailable.

Avoid for MVP unless explicitly requested:

- auth and users;
- complex database;
- Kubernetes/Docker orchestration;
- broad rewrites without baseline verification;
- dependency upgrades unrelated to the task.
