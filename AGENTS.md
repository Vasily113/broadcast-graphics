# Broadcast Graphics: Правила Команды И Агентов

Этот файл читают люди и Cursor Agent. Он описывает роли, зоны ответственности и
правила поведения для разработки MVP.

## Главный Контекст

Broadcast Graphics — MVP для эфирной графики. Приоритет:

- рабочий template editor;
- templates DB;
- rundowns;
- control panel;
- browser renderer;
- uploads;
- settings/channels;
- best-effort DeckLink compatibility;
- LLM template generation.

Главное условие: после изменений проект должен запускаться, а текущие
baseline-сценарии должны продолжать работать.

Не добавлять production-only сложность без явного решения Карена:

- auth/users/roles;
- сложную БД;
- Kubernetes/Docker platform;
- большие dependency upgrades;
- broad rewrite без baseline-проверки.

## Текущие Роли

### Карен: Team Lead, Architecture, Backend, Shared, LLM

Карен — тимлид и владелец foundation-ветки `refactoring-v1`.

Основная зона:

- `backend/src/index.ts`
- `backend/src/ws/**`
- `backend/src/services/llm/**`
- `backend/src/routes/llm.ts`
- `shared/**`
- repo scripts and workflow files
- `.cursor/rules/**`
- `AGENTS.md`
- `SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- GitHub Actions and PR process

Карен принимает решения по:

- architecture boundaries;
- shared contracts;
- API/WS protocol;
- LLM pipeline;
- branch protection;
- merge policy;
- Cursor rules.

### Сергей: Template Editor

Основная зона:

- `frontend/src/features/editor/**`
- `frontend/src/pages/EditorPage.tsx`
- editor UI;
- layers;
- properties panel;
- variables panel;
- timeline UI;
- canvas interactions.

Перед изменением спросить Карена:

- `shared/**`
- `frontend/src/core/renderer.ts`
- `frontend/src/core/timeline.ts`
- backend routes/services
- `frontend/src/pages/ControlPage.tsx`
- `frontend/src/pages/TemplatesPage.tsx`
- `decklink-out/**`

### Василий: Templates, Rundowns, Control, Integrations

Основная зона:

- `frontend/src/features/templates/**`
- `frontend/src/features/rundowns/**`
- `frontend/src/features/control/**`
- `frontend/src/pages/TemplatesPage.tsx`
- `frontend/src/pages/ControlPage.tsx` только для templates/rundowns/control UI
- `backend/src/routes/templates.ts`
- `backend/src/routes/rundowns.ts`
- `backend/src/routes/channels.ts`
- `backend/src/services/templates/**`
- `backend/src/services/rundowns/**`
- `backend/src/integrations/**`

Перед изменением спросить Карена:

- editor internals;
- renderer/timeline engine;
- LLM pipeline;
- `shared/**`;
- `decklink-out/**`;
- repo scripts/CI/workspaces.

## Общие Правила Агентов

Cursor Agent должен:

- читать релевантные файлы перед изменениями;
- держать изменения внутри requested product zone;
- если задача требует чужую зону, остановиться и объяснить почему;
- не менять shared schemas или API/WS protocol молча;
- не смешивать refactor и feature work без явного запроса;
- не коммитить и не пушить без явной просьбы;
- не редактировать plan files без явного запроса;
- сохранять baseline из `docs/baseline-checklist.md`;
- писать project-facing документацию на русском языке;
- использовать английский для `.cursor/rules`, code identifiers и технических API,
  где это удобнее.

## Git Workflow

- `MVP` — защищённая интеграционная ветка.
- `refactoring-v1` — foundation/team lead ветка Карена.
- Прямые коммиты в `MVP` запрещены.
- Все изменения проходят через PR.
- Карен review-ит каждый PR.
- Предпочтительный merge method: squash merge.

Рабочие ветки:

- `feature/sergey/<task>`
- `feature/vasily/<task>`
- `feature/lead/<task>`
- `fix/<owner>/<task>`

Пока `refactoring-v1` не влита в `MVP`, feature-ветки можно создавать от
`refactoring-v1`. После merge foundation в `MVP` новые задачи создавать от
`MVP`.

## Required Local Checks

Перед PR:

```bash
npm install
npm run typecheck
npm run build
./start.sh
```

Для foundation-level или demo-critical изменений дополнительно пройти:

```text
docs/baseline-checklist.md
```

## Shared Contracts

Shared contracts живут в:

```text
shared/src/**
```

Они используются для:

- template schema;
- timeline schema;
- rundown schema;
- channel/settings schema;
- control WebSocket protocol;
- LLM request/response schema.

Изменение shared contract требует в PR:

- что изменилось;
- какие frontend/backend/renderer/LLM зоны затронуты;
- можно ли reset `data/db.json`;
- какие baseline-сценарии проверены.

## MVP Constraints

Разрешено для MVP:

- lowdb JSON storage;
- open local/network access без auth;
- manual baseline checks;
- local llama.cpp server;
- simple fallback behavior if LLM is unavailable;
- best-effort DeckLink compatibility.

Избегать без явного решения Карена:

- auth and users;
- complex database;
- broad deployment platform;
- broad rewrites without baseline verification;
- dependency upgrades unrelated to task.

## Документы, Которые Нужно Знать

- `SPEC.md` — карта спецификации.
- `docs/ARCHITECTURE.md` — архитектурные границы.
- `docs/DEVELOPMENT.md` — запуск и локальная разработка.
- `docs/CURSOR_WORKFLOW.md` — как работать с Cursor.
- `docs/CONTRACTS.md` — API/WS/shared contracts.
- `docs/DEMO_RUNBOOK.md` — подготовка к демо.
- `docs/team-process.md` — ветки, PR, review.
- `docs/baseline-checklist.md` — ручной baseline.
