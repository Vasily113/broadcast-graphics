# Broadcast Graphics

Broadcast Graphics — MVP-система для подготовки и вывода эфирной графики:
шаблоны, редактор, таймлайн, рандауны, control panel, browser renderer,
загрузки медиа, настройки каналов и best-effort DeckLink output.

Главный приоритет проекта сейчас — рабочая demo-версия. Мы сохраняем простую
архитектуру, не добавляем auth, сложную БД и production-инфраструктуру без
отдельного решения тимлида.

## Быстрый Старт

Требования:

- Node.js 20+
- npm
- Linux/Ubuntu для основного dev-сценария
- Blackmagic Desktop Video и DeckLink SDK только для физической SDI-проверки

Установка и запуск:

```bash
npm install
./start.sh
```

После запуска:

- Frontend: `http://localhost:4000`
- Templates: `http://localhost:4000/templates`
- Control: `http://localhost:4000/control`
- Settings: `http://localhost:4000/settings`
- Backend API: `http://localhost:4001/api/templates`
- Browser renderer: `http://localhost:4001/renderer.html?channel=<channelId>`

Остановка:

```bash
./stop.sh
```

## Основные Команды

```bash
npm install
npm run typecheck
npm run build
npm run check
./start.sh
./stop.sh
```

DeckLink best-effort:

```bash
./build-decklink.sh
./start-decklink.sh
```

## Структура

```text
broadcast-graphics/
  backend/       TypeScript Express API, WebSocket, lowdb, LLM routes
  frontend/      React/Vite UI: templates, editor, control, settings, renderer
  shared/        Zod-схемы и shared-типы для API/WS/LLM contracts
  decklink-out/  Electron + native addon для SDI Fill+Key
  data/          lowdb JSON и uploads
  docs/          документация для команды
  .cursor/rules/ правила для Cursor Agent
```

## Главные Документы

- `SPEC.md` — карта всей документации проекта.
- `AGENTS.md` — роли команды и базовые правила агентов.
- `docs/ARCHITECTURE.md` — архитектурные границы и зависимости.
- `docs/PRODUCT_SPEC.md` — продуктовая спецификация MVP.
- `docs/DEVELOPMENT.md` — локальная разработка, запуск, проверки.
- `docs/CURSOR_WORKFLOW.md` — как команде работать с Cursor.
- `docs/CONTRACTS.md` — как менять API, WebSocket и shared-схемы.
- `docs/DEMO_RUNBOOK.md` — сценарий подготовки и проведения демо.
- `docs/baseline-checklist.md` — ручная проверка baseline-поведения.
- `docs/team-process.md` — ветки, PR, review и командный процесс.

## Рабочие Ветки

- `MVP` — защищенная интеграционная ветка.
- `refactoring-v1` — foundation/team lead ветка Карена.
- `feature/sergey/<task>` — задачи Сергея в editor-зоне.
- `feature/vasily/<task>` — задачи Василия в templates/rundowns/control-зоне.
- `feature/lead/<task>` — задачи тимлида после foundation.
- `fix/<owner>/<task>` — точечные исправления.

Прямые коммиты в `MVP` запрещены. Все изменения проходят через PR и review
тимлида.

## Ownership

- Карен: архитектура, backend core, shared contracts, LLM, CI, правила проекта.
- Сергей: template editor, canvas, layer properties, variables, timeline UI.
- Василий: templates DB/UI, rundowns, control workflows, channels, integrations.

Если задача требует изменения чужой зоны, разработчик или агент должен сначала
остановиться и объяснить причину.

## Definition Of Done

Перед PR:

```bash
npm run typecheck
npm run build
./start.sh
```

Для изменений в renderer/control/WebSocket/shared contracts дополнительно пройти
релевантные пункты из `docs/baseline-checklist.md`.
