# Broadcast Graphics Spec

Этот файл — главный вход в правила и спецификацию проекта. Если разработчик или
агент не понимает, куда смотреть, начинать нужно отсюда.

## Назначение Проекта

Broadcast Graphics — MVP для эфирной графики:

- создание и хранение графических шаблонов;
- визуальный template editor;
- переменные шаблонов для live-управления;
- timeline-анимации;
- control panel для TAKE/CLEAR/UPDATE;
- browser renderer для OBS/vMix;
- рандауны;
- загрузка медиа;
- настройки каналов;
- best-effort DeckLink Fill+Key output;
- LLM-генерация шаблонов через локальный llama.cpp server.

## Главный Принцип

Сейчас проект находится в MVP-режиме. Важнее всего:

1. проект запускается;
2. текущие пользовательские сценарии работают;
3. команда может параллельно разрабатывать без постоянных конфликтов;
4. архитектура остаётся достаточно простой, чтобы её понимали все трое.

Не добавляем production-only сложность без отдельного решения Карена:

- auth/users;
- сложную БД вместо lowdb;
- Kubernetes/Docker platform;
- большие dependency upgrades;
- переписывание всего проекта без baseline-проверки.

## Карта Документов

Документы для людей:

- `README.md` — краткий вход, запуск, структура и ссылки.
- `AGENTS.md` — роли команды и правила для людей/агентов.
- `docs/ARCHITECTURE.md` — архитектурные границы, модули, зависимости.
- `docs/PRODUCT_SPEC.md` — что должен уметь MVP.
- `docs/DEVELOPMENT.md` — как локально разрабатывать и проверять.
- `docs/CURSOR_WORKFLOW.md` — как правильно работать с Cursor Agent.
- `docs/CONTRACTS.md` — как менять shared-схемы, API и WS-протокол.
- `docs/DEMO_RUNBOOK.md` — как готовиться к демо и что показывать.
- `docs/baseline-checklist.md` — ручной baseline перед merge.
- `docs/team-process.md` — ветки, PR, review, ежедневный статус.

Правила для Cursor Agent:

- `.cursor/rules/project.mdc` — общие правила проекта.
- `.cursor/rules/sergey-editor.mdc` — editor-зона Сергея.
- `.cursor/rules/vasily-rundowns.mdc` — templates/rundowns/control-зона Василия.
- `.cursor/rules/lead-architecture.mdc` — зона Карена.
- `.cursor/rules/contracts.mdc` — shared contracts, API, WS.
- `.cursor/rules/frontend-feature-modules.mdc` — структура frontend features.
- `.cursor/rules/backend-routes-services.mdc` — структура backend routes/services.
- `.cursor/rules/mvp-scope.mdc` — ограничения MVP.
- `.cursor/rules/demo-safety.mdc` — защита demo-critical сценариев.
- `.cursor/rules/llm-generation.mdc` — правила LLM-пайплайна.

## Что Является Источником Правды

- Продуктовые сценарии: `docs/PRODUCT_SPEC.md` и `docs/baseline-checklist.md`.
- Архитектурные границы: `docs/ARCHITECTURE.md`.
- Командный процесс: `docs/team-process.md`.
- Cursor-процесс: `docs/CURSOR_WORKFLOW.md`.
- API/WS/schema contracts: `shared/src/**` и `docs/CONTRACTS.md`.
- Agent behavior: `AGENTS.md` и `.cursor/rules/*.mdc`.

Если документы конфликтуют, порядок приоритета такой:

1. прямое решение Карена в текущей задаче;
2. `AGENTS.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/CONTRACTS.md`;
5. `.cursor/rules/*.mdc`;
6. остальные документы.

## Минимальный Процесс Любого Изменения

1. Взять задачу и определить owner-зону.
2. Создать feature-ветку от актуальной `MVP` или временно от `karen`, если
   foundation ещё не влит.
3. Дать Cursor явный контекст: кто работает, какая зона, какие файлы нельзя
   менять.
4. Внести изменения строго в рамках задачи.
5. Запустить `npm run typecheck`, `npm run build`, `./start.sh`.
6. Проверить релевантный ручной сценарий.
7. Открыть PR.
8. Получить review Карена.
9. Merge через squash.

## Запреты По Умолчанию

Без явного решения Карена нельзя:

- менять shared contracts “по пути”;
- смешивать feature и большой refactor в одном PR;
- менять `start.sh`, `stop.sh`, ports, CI или npm workspaces без причины;
- переносить проект на другую БД;
- добавлять auth;
- менять public API/WS protocol без обновления frontend/backend/renderer;
- ломать baseline ради внутренней красоты кода.
