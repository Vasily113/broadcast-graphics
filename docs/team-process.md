# Team Process

Этот документ описывает, как команда из трёх разработчиков работает над MVP без
постоянных конфликтов.

## Ветки

- `MVP` — защищённая интеграционная ветка.
- `refactoring-v1` — foundation/team lead ветка Карена.
- `feature/sergey/<task>` — задачи Сергея.
- `feature/vasily/<task>` — задачи Василия.
- `feature/lead/<task>` — задачи Карена после foundation.
- `fix/<owner>/<task>` — точечные исправления.

Прямые коммиты в `MVP` запрещены.

Пока foundation не влита:

```bash
git checkout refactoring-v1
git pull
git checkout -b feature/<owner>/<task>
```

После merge `refactoring-v1` в `MVP`:

```bash
git checkout MVP
git pull
git checkout -b feature/<owner>/<task>
```

## Branch Protection Для `MVP`

В GitHub желательно включить:

- require pull request before merging;
- require 1 approval;
- require status checks to pass;
- required check: `Typecheck and build`;
- require branch to be up to date before merge;
- restrict direct pushes to `MVP`, если доступно;
- allow squash merge and prefer squash merge.

## Daily Async Status

Каждый разработчик в начале/конце рабочего блока пишет:

```text
Кто:
Branch:
Task:
Files/zones I am touching:
What changed today:
Blockers:
Could affect:
PR link:
```

Пример:

```text
Кто: Сергей
Branch: feature/sergey/layer-opacity
Task: opacity control for editor layers
Files/zones I am touching: frontend/src/features/editor/**
What changed today: added opacity input in properties panel
Blockers: none
Could affect: editor preview rendering
PR link: <link>
```

## Weekly Planning

Раз в неделю:

- выбрать 3-5 MVP-задач;
- назначить owner для каждой;
- отметить shared/hot files, которые нельзя менять параллельно;
- решить, нужен ли foundation/refactor PR перед feature work;
- подтвердить demo-critical path;
- решить, какие задачи можно безопасно дать Cursor Agent.

## Review Rules

- Карен review-ит каждый PR.
- Shared contract changes требуют явного review.
- Backend/renderer/timeline/package changes требуют extra care.
- UI PR должен содержать screenshot или короткое видео.
- Foundation PR должен пройти `docs/baseline-checklist.md`.
- PR не должен смешивать unrelated refactor и feature.

## Definition Of Done

PR готов к review, если:

- scope соответствует одной задаче;
- diff не содержит accidental files;
- `npm run typecheck` проходит;
- `npm run build` проходит;
- `./start.sh` запускает проект;
- manual scenario проверен;
- contract changes задокументированы;
- owner-zone указана;
- screenshots/video приложены для UI;
- Карен review завершил.

## Горячие Файлы

Особенно аккуратно менять:

- `shared/src/**`;
- `backend/src/index.ts`;
- `backend/src/ws/**`;
- `frontend/src/core/renderer.ts`;
- `frontend/src/core/timeline.ts`;
- `frontend/src/core/store.ts`;
- `frontend/src/pages/ControlPage.tsx`;
- `frontend/src/pages/TemplatesPage.tsx`;
- `package.json`;
- `package-lock.json`;
- `start.sh`;
- `stop.sh`;
- `.cursor/rules/**`.

Если два человека должны менять один hot file, сначала согласовать порядок.

## Коммиты И Push

Cursor Agent не должен делать commit/push без явной просьбы.

Перед commit:

```bash
git status
git diff
npm run typecheck
npm run build
```

Перед push убедиться, что ветка правильная:

```bash
git branch --show-current
```

## Merge Policy

Предпочтительно:

- small PR;
- review by Karen;
- green CI;
- squash merge;
- удалить feature branch после merge.

Не вливать PR, если:

- CI красный;
- baseline сломан;
- есть неописанный contract change;
- PR меняет чужую зону без согласования;
- есть случайные файлы или debug artifacts.
