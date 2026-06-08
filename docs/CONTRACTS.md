# Contracts Guide

Contracts — это соглашения между frontend, backend, renderer, control panel,
rundowns, DeckLink wrapper и LLM pipeline.

В этом проекте contracts живут в:

```text
shared/src/**
```

Главное правило: если меняется contract, нужно обновить все affected стороны в
одном PR и явно описать изменение.

## Что Считается Contract

Contract change — это изменение:

- template schema;
- layer schema;
- variable schema;
- timeline schema;
- rundown schema;
- channel/settings schema;
- HTTP request body;
- HTTP response shape;
- WebSocket command shape;
- LLM request/response;
- structure of `data/db.json`.

Даже если TypeScript “почти пропустил”, это всё равно contract change.

## Источник Правды

Shared schemas:

```text
shared/src/template/schema.ts
shared/src/timeline/schema.ts
shared/src/rundown/schema.ts
shared/src/channel/schema.ts
shared/src/control/protocol.ts
shared/src/llm/schema.ts
shared/src/common/id.ts
```

Backend должен валидировать входящие данные через shared schemas или schemas,
совместимые с ними.

Frontend должен использовать типы/форму данных, совместимую с shared schemas.

LLM output должен проходить validation перед сохранением.

## Как Добавить Поле В Template

Пример процесса:

1. Изменить schema в `shared/src/template/schema.ts`.
2. Проверить, нужны ли изменения в `frontend/src/core/schema.ts`.
3. Обновить editor UI, если поле редактируется пользователем.
4. Обновить renderer, если поле влияет на визуальный вывод.
5. Обновить backend validation/routes, если поле приходит через API.
6. Обновить LLM generation, если LLM должен уметь создавать это поле.
7. Запустить:

```bash
npm run typecheck
npm run build
```

8. Проверить manual flow: создать шаблон, сохранить, открыть, вывести в renderer.
9. Описать contract change в PR.

## Как Добавить Поле В Rundown

1. Изменить `shared/src/rundown/schema.ts`.
2. Обновить backend routes/services для rundowns.
3. Обновить `frontend/src/features/rundowns/**`.
4. Обновить control UI, если поле влияет на TAKE/NEXT/PREV.
5. Проверить сохранение в `data/db.json`.
6. Проверить reload страницы.
7. Описать, можно ли сбросить старый `data/db.json`.

## Как Изменить WebSocket Protocol

WebSocket protocol находится в:

```text
shared/src/control/protocol.ts
backend/src/ws/**
frontend/src/features/control/**
frontend/src/pages/RendererPage.tsx
backend/public/renderer.html
decklink-out/src/main.js
```

Перед изменением нужно понять:

- какие команды меняются;
- кто отправляет команду;
- кто её получает;
- нужен ли replay для late renderer connection;
- как будет вести себя старый on-air state.

Минимальная проверка:

- Control TAKE работает.
- Control UPDATE работает.
- Control CLEAR работает.
- Browser renderer получает команды.
- Позднее подключение renderer получает актуальный state.

## Как Изменить HTTP API

Backend route должен:

- принять request;
- провалидировать input;
- вернуть предсказуемый JSON;
- не отдавать HTML/error text как успешный API response;
- использовать понятный HTTP status code.

Frontend API client должен:

- жить в `frontend/src/features/<feature>/api.ts`;
- не дублировать fetch logic по страницам;
- иметь понятную ошибку при не-JSON ответе;
- не подменять contract silently.

## LLM Contracts

LLM никогда не является источником правды.

Правильный поток:

```text
prompt -> llama.cpp response -> JSON parse -> shared schema validation -> safe template draft
```

Если LLM вернул мусор:

- не сохранять мусор;
- вернуть fallback или validation error;
- не ломать Templates page;
- оставить возможность создать шаблон вручную.

## Data/db.json

`data/db.json` — persistence для MVP, но не formal migration system.

Для MVP можно сбрасывать данные, если:

- это явно указано в PR;
- Карен согласен;
- baseline/demo templates можно восстановить;
- команда понимает последствия.

Если данные нельзя сбросить, нужно добавить совместимость или простой conversion
path. Сложную migration system пока не добавляем без отдельного решения.

## PR Template Для Contract Change

В PR обязательно указать:

```text
Contract changed:
- What changed:
- Affected frontend:
- Affected backend:
- Affected renderer/control:
- Affected LLM:
- Can data/db.json be reset:
- Manual checks:
```

## Запреты

Нельзя:

- менять shared schema без обновления affected code;
- менять API response и “починить только frontend”;
- сохранять LLM output без validation;
- менять WS command shape без renderer/control проверки;
- прятать contract change внутри большого UI PR;
- добавлять compatibility layer без реальной необходимости для MVP.

## Когда Нужен Отдельный PR

Лучше делать отдельный PR, если изменение:

- затрагивает `shared/src/**`;
- меняет WebSocket protocol;
- меняет структуру stored data;
- требует одновременного изменения backend, frontend и renderer;
- может сломать demo-critical flow.
