# Cursor Workflow

Этот документ объясняет, как Карен, Сергей и Василий должны работать с Cursor
Agent в одном репозитории, чтобы не ломать чужие зоны и не создавать постоянные
конфликты.

## Главный Принцип

Cursor Agent должен работать не как самостоятельный архитектор, а как помощник
внутри правил проекта.

Перед каждой задачей разработчик обязан явно сказать агенту:

- кто он;
- в какой ветке работает;
- какая задача;
- какая ownership-зона;
- какие файлы нельзя менять без вопроса;
- нужно ли делать commit/push или нет.

## Общие Правила Для Всех

Перед задачей:

1. Обновить базовую ветку.
2. Создать feature-ветку.
3. Сформулировать задачу Cursor.
4. Указать ограничения.
5. Попросить сначала прочитать релевантные файлы.

После задачи:

1. Посмотреть diff.
2. Убедиться, что нет случайных файлов.
3. Запустить проверки.
4. Проверить UI вручную.
5. Только потом просить Cursor сделать commit/push, если это нужно.

## Ветки

Пока foundation живёт в `refactoring-v1`, новые задачи можно временно начинать от неё:

```bash
git checkout refactoring-v1
git pull
git checkout -b feature/sergey/<task>
```

После merge foundation в `MVP` все новые задачи начинать от `MVP`:

```bash
git checkout MVP
git pull
git checkout -b feature/vasily/<task>
```

Не работать напрямую в `MVP`. Не работать напрямую в чужой feature-ветке.

## Промпт Для Карена

```text
Я Карен, тимлид проекта.
Работаю в ветке <branch>.
Моя зона: architecture/backend/shared/LLM/repo process.

Задача:
<описание задачи>

Перед изменениями прочитай AGENTS.md, SPEC.md и релевантные docs.
Можно менять backend/shared/LLM/rules/docs, если это нужно для задачи.
Нельзя ломать baseline из docs/baseline-checklist.md.
Не делай commit/push, пока я явно не попрошу.
```

## Промпт Для Сергея

```text
Я Сергей.
Работаю в ветке feature/sergey/<task>.
Моя зона: template editor.

Задача:
<описание задачи>

Разрешённые зоны:
- frontend/src/features/editor/**
- frontend/src/pages/EditorPage.tsx

Перед изменениями прочитай AGENTS.md, docs/ARCHITECTURE.md и editor-related files.
Не меняй shared/**, backend/**, decklink-out/**, renderer/timeline engine,
ControlPage или TemplatesPage без отдельного вопроса.
Если задача требует schema/API/protocol change, остановись и объясни, что нужно.
Не делай commit/push, пока я явно не попрошу.
```

## Промпт Для Василия

```text
Я Василий.
Работаю в ветке feature/vasily/<task>.
Моя зона: templates/rundowns/control/channels/integrations.

Задача:
<описание задачи>

Разрешённые зоны:
- frontend/src/features/templates/**
- frontend/src/features/rundowns/**
- frontend/src/features/control/**
- frontend/src/pages/TemplatesPage.tsx
- frontend/src/pages/ControlPage.tsx
- backend/src/routes/templates.ts
- backend/src/routes/rundowns.ts
- backend/src/routes/channels.ts
- backend/src/integrations/**

Перед изменениями прочитай AGENTS.md, docs/ARCHITECTURE.md и relevant feature files.
Не меняй editor internals, LLM pipeline, shared schemas, renderer/timeline engine
или decklink-out/** без отдельного вопроса.
Не делай commit/push, пока я явно не попрошу.
```

## Как Просить Cursor Делать Задачу

Хорошо:

```text
Добавь фильтр шаблонов по названию на TemplatesPage.
Работай только в templates feature зоне.
Сначала найди текущий API client и структуру данных.
Не меняй backend/shared.
После изменений проверь lints/type errors.
```

Плохо:

```text
Улучши страницу шаблонов и поправь архитектуру.
```

Плохой промпт слишком широкий. Агент может начать менять unrelated files.

## Когда Cursor Должен Остановиться

Агент должен остановиться и спросить, если:

- задача требует изменения `shared/**`;
- нужно изменить API response/request shape;
- нужно изменить WebSocket protocol;
- нужно изменить `data/db.json` structure;
- задача выходит за owner-зону;
- нужно поменять `package.json`, lockfile, CI или scripts;
- нужно удалить или переписать большой файл;
- появляется желание сделать “заодно” refactor вне задачи.

## Как Смотреть Diff

Перед commit разработчик должен проверить:

```bash
git status
git diff
```

Нужно убедиться:

- изменены только файлы задачи;
- нет случайных generated/cache/media файлов;
- нет unrelated refactor;
- нет debug logs;
- нет временных комментариев;
- нет секретов.

## Cursor Rules

`.cursor/rules/*.mdc` лежат в репозитории и являются общими для всех. Их не
нужно копировать локально каждому разработчику.

Карен управляет этими файлами через PR. После `git pull` Сергей и Василий
получают актуальные правила, и их Cursor Agent начинает использовать их в этом
проекте.

Локальные настройки Cursor у каждого могут отличаться, но project rules должны
быть общими.

## Частые Ошибки

Ошибка: попросить Cursor “починить всё”.

Правильно: дать маленькую задачу и зону.

Ошибка: разрешить агенту менять shared schemas в UI-задаче.

Правильно: остановиться, написать contract proposal, дождаться решения Карена.

Ошибка: делать commit/push автоматически после каждой правки.

Правильно: сначала review diff, проверки, ручной сценарий, потом commit/push по
явной просьбе.

Ошибка: несколько человек меняют `ControlPage.tsx` одновременно.

Правильно: заранее договориться, кто владеет файлом в конкретной задаче, или
сначала вынести логику в feature-модуль.

## Минимальный Checklist Перед PR

```bash
npm run typecheck
npm run build
./start.sh
```

Плюс:

- UI проверен вручную;
- screenshots/video приложены, если UI менялся;
- contract changes описаны, если были;
- affected zones указаны;
- PR не содержит случайных файлов.
