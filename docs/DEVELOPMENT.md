# Development Guide

Этот документ отвечает на вопрос: как разработчику локально работать с проектом
и что проверять перед PR.

## Требования

Обязательно:

- Node.js 20+
- npm
- bash-compatible shell для `start.sh`/`stop.sh`

Опционально для DeckLink:

- Blackmagic Desktop Video;
- DeckLink SDK;
- system build tools для native addon;
- физическая DeckLink-карта.

## Первый Запуск

```bash
npm install
npm run typecheck
npm run build
./start.sh
```

Открыть:

- `http://localhost:4000/templates`
- `http://localhost:4000/control`
- `http://localhost:4000/settings`
- `http://localhost:4001/renderer.html?channel=<channelId>`

Остановить:

```bash
./stop.sh
```

## Порты

По умолчанию:

- frontend: `4000`
- backend: `4001`

Можно переопределить:

```bash
FRONTEND_PORT=4100 BACKEND_PORT=4101 ./start.sh
```

Если порт занят:

```bash
./stop.sh
```

Если после этого порт всё ещё занят, сначала выяснить, какой процесс его держит.
Не убивать процессы вслепую, если непонятно, что это.

## npm Workspaces

Корневой `package.json` управляет пакетами:

- `@broadcast-graphics/shared`
- `@broadcast-graphics/backend`
- `@broadcast-graphics/frontend`
- `@broadcast-graphics/decklink-out`

Основные команды:

```bash
npm run typecheck
npm run build
npm run check
```

Package-specific команды:

```bash
npm run build -w @broadcast-graphics/shared
npm run build -w @broadcast-graphics/backend
npm run build -w @broadcast-graphics/frontend
npm run typecheck -w @broadcast-graphics/backend
```

## Backend

Backend написан на TypeScript.

Основные зоны:

- `backend/src/index.ts` — сборка Express app, middleware, routes, WS.
- `backend/src/db.ts` — lowdb.
- `backend/src/routes/**` — HTTP routes.
- `backend/src/ws/**` — WebSocket state и broadcast.
- `backend/src/services/**` — бизнес-логика и внешние клиенты.

Backend build:

```bash
npm run build -w @broadcast-graphics/backend
```

Backend start из build:

```bash
npm start -w @broadcast-graphics/backend
```

Обычно вручную это делать не нужно: `./start.sh` собирает shared/backend и
запускает backend из `dist`.

## Frontend

Frontend — React/Vite.

Основные зоны:

- `frontend/src/pages/**` — страницы.
- `frontend/src/features/**` — feature-модули.
- `frontend/src/core/**` — renderer, timeline, store, shared frontend utils.
- `frontend/src/ui/**` — переиспользуемый UI.

Vite dev server:

```bash
npm run dev -w @broadcast-graphics/frontend
```

В обычном режиме использовать `./start.sh`, чтобы backend/frontend были на
согласованных портах.

## Shared

`shared/src/**` содержит Zod-схемы и shared-типы.

При изменении shared:

```bash
npm run typecheck
npm run build
```

Также нужно обновить affected frontend/backend code и описать contract change в
PR.

## Database

MVP использует lowdb JSON:

```text
data/db.json
```

Для MVP существующие данные можно сбрасывать, если это явно указано в PR и
согласовано с Кареном.

Нельзя менять структуру данных “между делом”. Если меняется структура template,
rundown, channel или settings, это contract change.

## Uploads

Загруженные файлы лежат в:

```text
data/uploads/
```

Не коммитить случайные большие media-файлы, если они не нужны как demo fixture.

## DeckLink

DeckLink output не является блокером для обычной frontend/backend задачи, но
нельзя ломать его очевидно.

Best-effort команды:

```bash
./build-decklink.sh
./start-decklink.sh
```

Если физической карты нет, достаточно проверить:

- frontend/backend работают;
- browser renderer работает;
- `start-decklink.sh` сообщает понятную ошибку или корректно находит backend;
- `decklink-out/src/main.js` не получил очевидную runtime/syntax проблему.

## Перед PR

Минимум:

```bash
npm run typecheck
npm run build
./start.sh
```

Для UI-задач:

- открыть изменённую страницу;
- проверить основной сценарий;
- приложить screenshot/video в PR.

Для shared/API/WS:

- обновить `docs/CONTRACTS.md`, если меняется правило;
- описать request/response/protocol change;
- проверить affected frontend/backend/renderer.

Для foundation/architecture:

- пройти `docs/baseline-checklist.md`;
- указать, какие пункты проверены;
- явно описать intentional behavior changes.

## Типовые Проблемы

### `templates.map is not a function`

Обычно frontend получил не массив templates, а HTML/error response. Проверить:

- backend запущен на `4001`;
- frontend proxy смотрит на правильный backend port;
- `/api/templates` возвращает JSON array.

### `Port 4000/4001 is already in use`

```bash
./stop.sh
```

Если не помогло, найти процесс через `ss`/IDE terminals и только потом
останавливать.

### LLM Не Работает

Это не должно ломать приложение. Должен сработать fallback. Проверить:

- llama.cpp server запущен, если нужен реальный LLM;
- backend env/config указывает на правильный endpoint;
- response проходит shared schema validation.

## Чего Не Делать

- Не коммитить `node_modules`.
- Не менять generated lockfiles без npm-команды.
- Не делать `git reset --hard` без явного разрешения.
- Не смешивать refactor и feature без согласования.
- Не менять `shared/**` в UI-задаче без отдельного объяснения.
- Не чинить unrelated code “заодно”.
