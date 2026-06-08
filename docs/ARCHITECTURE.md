# Архитектура Broadcast Graphics

Этот документ описывает архитектурные границы проекта. Его цель — не объяснить
каждую строку кода, а защитить проект от хаотичных изменений, особенно при
работе нескольких разработчиков и Cursor Agent.

## Текущая Архитектурная Цель

Проект строится как простой monorepo-MVP:

- один репозиторий;
- npm workspaces;
- TypeScript backend;
- React/Vite frontend;
- shared Zod contracts;
- lowdb JSON storage;
- local/network запуск без auth;
- browser renderer и best-effort DeckLink output.

Мы не строим production platform. Любое усложнение должно прямо помогать MVP,
демо или параллельной разработке команды.

## Модули

```text
broadcast-graphics/
  frontend/      UI, editor, control panel, renderer page
  backend/       HTTP API, WebSocket, persistence, LLM adapter
  shared/        Zod schemas and shared TypeScript types
  decklink-out/  Electron wrapper for SDI output
  data/          lowdb JSON database and uploaded media
```

## Разрешённые Зависимости

```text
frontend -> shared
backend -> shared
decklink-out -> backend HTTP/WS
browser renderer -> backend HTTP/WS
scripts -> packages
```

Запрещённые зависимости:

```text
shared -> frontend
shared -> backend
backend -> frontend
frontend -> backend source files
decklink-out -> frontend source files
feature module -> unrelated feature internals
```

`shared` должен оставаться самым нижним слоем. В нём не должно быть React,
Express, lowdb, DOM, Electron или бизнес-логики конкретного UI.

## Frontend

Frontend отвечает за:

- страницы приложения;
- редактор шаблонов;
- templates UI;
- rundowns UI;
- control panel;
- settings/channels UI;
- browser renderer page;
- HTTP/WS clients.

Правило:

- `frontend/src/pages/**` должны быть относительно тонкими страницами.
- Большую логику держим в `frontend/src/features/**`.
- API-запросы держим в `frontend/src/features/<feature>/api.ts`.
- Feature-типы держим в `frontend/src/features/<feature>/types.ts`.
- Общие низкоуровневые утилиты frontend держим в `frontend/src/core/**`.

Нежелательно:

- добавлять большие fetch-блоки прямо в страницы;
- смешивать editor state и control state;
- импортировать код backend;
- менять renderer/timeline engine внутри обычной UI-задачи.

## Backend

Backend отвечает за:

- HTTP API;
- WebSocket control/renderer protocol;
- lowdb persistence;
- uploads;
- LLM endpoints and adapters;
- serving backend public renderer assets.

Правило:

- `backend/src/index.ts` только собирает приложение, middleware, routes и WS.
- `backend/src/routes/**` принимают HTTP, валидируют input и вызывают нужную
  логику.
- `backend/src/services/**` содержит бизнес-логику и внешние интеграции.
- `backend/src/ws/**` содержит WebSocket state и broadcast logic.
- `backend/src/db.ts` изолирует lowdb.

Нежелательно:

- превращать `index.ts` в монолит;
- держать WebSocket protocol внутри frontend;
- сохранять непроверенные данные без schema validation;
- добавлять новую инфраструктуру, если lowdb достаточно для MVP.

## Shared Contracts

`shared/src/**` — это контракт между frontend, backend, renderer, control,
rundowns и LLM.

В shared находятся:

- template schema;
- timeline schema;
- rundown schema;
- channel/settings schema;
- control WebSocket protocol;
- LLM request/response schema;
- общие типы id/timestamp.

Любое изменение shared-схемы считается cross-zone change и должно быть явно
описано в PR.

## Data Flow: TAKE

```text
Control Panel
  -> /ws/control command
  -> backend validates/broadcasts
  -> onAirState updates in memory
  -> renderer clients receive command
  -> TemplateRenderer draws graphics
  -> OBS browser source or decklink-out consumes frames
```

Backend хранит текущий on-air state в памяти. При подключении renderer получает
replay актуального состояния своего канала.

## Data Flow: Template CRUD

```text
Templates UI
  -> frontend templates api client
  -> backend /api/templates route
  -> shared schema validation
  -> lowdb data/db.json
```

Frontend не должен знать внутреннюю структуру lowdb. Backend не должен знать
React-компоненты.

## Data Flow: LLM Template Generation

```text
GenerateTemplatePanel
  -> frontend LLM api client
  -> backend /api/llm route
  -> templateGenerator service
  -> llamaCppClient or fallback
  -> shared TemplateSchema validation
  -> template saved via normal templates flow
```

LLM JSON нельзя сохранять как есть. Сначала он должен пройти validation через
shared-схему.

## Ownership

Карен:

- `backend/src/index.ts`
- `backend/src/ws/**`
- `backend/src/services/llm/**`
- `backend/src/routes/llm.ts`
- `shared/**`
- `.cursor/rules/**`
- `AGENTS.md`
- CI, scripts, architecture docs

Сергей:

- `frontend/src/features/editor/**`
- `frontend/src/pages/EditorPage.tsx`
- editor UI, layers, properties, variables, timeline UI

Василий:

- `frontend/src/features/templates/**`
- `frontend/src/features/rundowns/**`
- `frontend/src/features/control/**`
- `frontend/src/pages/TemplatesPage.tsx`
- `frontend/src/pages/ControlPage.tsx`
- templates/rundowns/channels backend routes
- external integrations

## Архитектурные Red Flags

PR требует особого внимания, если он:

- меняет `shared/src/**`;
- меняет WebSocket command shape;
- меняет `data/db.json` structure;
- меняет `frontend/src/core/renderer.ts`;
- меняет `frontend/src/core/timeline.ts`;
- меняет `backend/src/index.ts`;
- меняет `start.sh`, `stop.sh`, ports или npm workspaces;
- смешивает feature и refactor;
- добавляет dependency без явной причины;
- ломает baseline-сценарии.

## Когда Можно Нарушить Правило

Можно, если:

1. Карен явно разрешил;
2. причина описана в PR;
3. затронутые зоны перечислены;
4. baseline проверен;
5. команда понимает последствия.

В MVP лучше простое и работающее решение, чем правильная, но тяжёлая
enterprise-архитектура.
