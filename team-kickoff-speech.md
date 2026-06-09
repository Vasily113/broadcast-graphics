# Речь Для Командной Встречи: Как Мы Теперь Работаем

Этот документ — готовая структурированная речь для встречи Карена с Сергеем и
Василием. Её можно читать почти дословно. Цель встречи — чтобы у команды не
осталось неопределённости: кто за что отвечает, как работать с Cursor, как вести
ветки, как не конфликтовать и как доводить задачи до merge.

## 1. Вступление

Ребята, хочу сейчас спокойно и подробно объяснить, как мы дальше работаем над
проектом Broadcast Graphics.

Мы сейчас на важном этапе. У нас уже есть рабочий MVP: шаблоны, редактор,
control panel, рандауны, renderer, uploads, settings/channels, best-effort
DeckLink и первая база под LLM-генерацию шаблонов. Наша задача теперь — не просто
добавлять фичи, а добавлять их так, чтобы мы втроём могли работать параллельно и
не ломать друг другу код.

Самое главное правило: проект должен оставаться рабочим. Любое изменение,
любая фича, любой рефакторинг должны проходить через вопрос: после этого проект
запускается и основные сценарии всё ещё работают?

Мы не строим сейчас идеальную production-систему. Мы делаем MVP для демо. Это
значит, что нам важны рабочие пользовательские сценарии, понятная архитектура,
предсказуемые ветки, review и аккуратная работа с Cursor.

## 2. Главная Идея Нового Процесса

Раньше можно было воспринимать проект как одну общую папку, где каждый может
пойти в любой файл и что-то поменять. Теперь так работать нельзя.

Теперь у нас есть три принципа:

1. У каждого есть своя зона ответственности.
2. Все изменения идут через отдельные ветки и PR.
3. Cursor Agent должен работать внутри правил проекта, а не сам решать
   архитектуру.

Это не бюрократия ради бюрократии. Это защита от конфликтов, случайных
изменений, сломанных shared-схем, разъезжающихся API и огромных diff-ов, которые
невозможно нормально review-ить.

## 3. Кто За Что Отвечает

### Карен

Я отвечаю за foundation и архитектурную часть проекта.

Моя зона:

- backend core;
- WebSocket protocol;
- shared contracts;
- LLM template generation;
- npm workspaces;
- CI;
- repo scripts;
- `.cursor/rules`;
- `AGENTS.md`;
- `SPEC.md`;
- архитектурная документация;
- review всех PR.

Если нужно менять `shared/**`, backend core, WebSocket protocol, LLM pipeline,
scripts, CI, правила Cursor или архитектурные документы — это моя зона или как
минимум зона, которую нужно согласовать со мной.

### Сергей

Сергей отвечает за template editor.

Основная зона Сергея:

- `frontend/src/features/editor/**`;
- `frontend/src/pages/EditorPage.tsx`;
- editor UI;
- canvas interactions;
- layers;
- layer properties;
- variables panel;
- timeline UI;
- interactions внутри редактора.

Если задача касается того, как пользователь создаёт, двигает, редактирует слои,
настраивает свойства, работает с переменными и анимациями внутри editor — это
зона Сергея.

Сергей не должен без отдельного согласования менять:

- `shared/**`;
- backend;
- WebSocket protocol;
- `frontend/src/core/renderer.ts`;
- `frontend/src/core/timeline.ts`;
- `frontend/src/pages/ControlPage.tsx`;
- `frontend/src/pages/TemplatesPage.tsx`;
- `decklink-out/**`;
- scripts и CI.

Если во время editor-задачи Cursor говорит: "надо поменять shared schema" или
"надо поправить backend route", Сергей не должен просто разрешать это. Нужно
остановиться и написать мне: "задача требует contract/backend change, вот почему".

### Василий

Василий отвечает за templates, rundowns, control workflows, channels и внешние
интеграции.

Основная зона Василия:

- `frontend/src/features/templates/**`;
- `frontend/src/features/rundowns/**`;
- `frontend/src/features/control/**`;
- `frontend/src/pages/TemplatesPage.tsx`;
- `frontend/src/pages/ControlPage.tsx` в части templates/rundowns/control UI;
- `backend/src/routes/templates.ts`;
- `backend/src/routes/rundowns.ts`;
- `backend/src/routes/channels.ts`;
- `backend/src/integrations/**`.

Если задача касается списка шаблонов, рандаунов, control panel, каналов,
интеграций с внешними системами — это зона Василия.

Василий не должен без отдельного согласования менять:

- editor internals;
- renderer/timeline engine;
- LLM pipeline;
- `shared/**`;
- `decklink-out/**`;
- repo scripts;
- CI;
- npm workspace config;
- `.cursor/rules`.

Если задача в templates или rundowns внезапно требует изменить структуру
шаблона, rundown schema или WebSocket-команду, это уже contract change. Его нужно
согласовать.

## 4. Как Теперь Работают Ветки

У нас есть главные ветки:

- `MVP` — защищённая интеграционная ветка.
- `refactoring-v1` — моя foundation/team lead ветка.

Прямо в `MVP` никто не коммитит.

Пока foundation из `refactoring-v1` ещё не влита в `MVP`, новые feature-ветки можно
создавать от `refactoring-v1`.

Пример:

```bash
git checkout refactoring-v1
git pull
git checkout -b feature/sergey/editor-layer-opacity
```

Или:

```bash
git checkout refactoring-v1
git pull
git checkout -b feature/vasily/rundown-slot-notes
```

После того как `refactoring-v1` будет влита в `MVP`, новые задачи начинаем от `MVP`:

```bash
git checkout MVP
git pull
git checkout -b feature/sergey/editor-layer-opacity
```

Или:

```bash
git checkout MVP
git pull
git checkout -b feature/vasily/rundown-slot-notes
```

Правило простое:

- Сергей работает в `feature/sergey/<task>`.
- Василий работает в `feature/vasily/<task>`.
- Я после foundation работаю в `feature/lead/<task>`.
- Исправления идут в `fix/<owner>/<task>`.

Никто не работает напрямую в чужой feature-ветке. Если нужно помочь другому,
сначала договориться.

## 5. Как Мы Используем Cursor

Cursor — это не волшебный архитектор, которому можно сказать "сделай красиво".
Cursor — это помощник, которому нужно давать точную задачу, точную зону и
ограничения.

Перед каждой задачей нужно явно написать агенту:

- кто я;
- в какой ветке я работаю;
- какая у меня ownership-зона;
- какая конкретно задача;
- какие файлы можно менять;
- какие файлы нельзя менять без вопроса;
- нужно ли делать commit/push.

По умолчанию Cursor не должен делать commit и push. Commit/push делаем только
после явной просьбы.

### Пример Хорошего Промпта Для Сергея

```text
Я Сергей. Работаю в ветке feature/sergey/editor-layer-opacity.
Моя зона: template editor.

Задача: добавить управление opacity для выбранного слоя в properties panel.

Разрешённые зоны:
- frontend/src/features/editor/**
- frontend/src/pages/EditorPage.tsx

Перед изменениями прочитай AGENTS.md, docs/ARCHITECTURE.md и relevant editor files.
Не меняй shared/**, backend/**, ControlPage, TemplatesPage, renderer/timeline
engine или decklink-out/** без отдельного вопроса.
Не делай commit/push, пока я явно не попрошу.
```

### Пример Хорошего Промпта Для Василия

```text
Я Василий. Работаю в ветке feature/vasily/templates-search.
Моя зона: templates/rundowns/control/channels.

Задача: добавить поиск шаблонов по названию на TemplatesPage.

Разрешённые зоны:
- frontend/src/features/templates/**
- frontend/src/pages/TemplatesPage.tsx

Перед изменениями прочитай AGENTS.md, docs/ARCHITECTURE.md и templates feature files.
Не меняй editor internals, shared schemas, LLM, renderer/timeline engine или
decklink-out/** без отдельного вопроса.
Не делай commit/push, пока я явно не попрошу.
```

### Пример Плохого Промпта

```text
Улучши страницу шаблонов и поправь архитектуру.
```

Так нельзя. Это слишком широко. Агент может полезть в shared, backend, pages,
store, renderer, начать рефакторить unrelated files и создать огромный diff,
который мы не сможем нормально review-ить.

## 6. Как Работают `AGENTS.md` И `.cursor/rules`

В проекте теперь есть `AGENTS.md` и `.cursor/rules`.

`AGENTS.md` — это общий документ для людей и агентов. Там описано:

- кто за что отвечает;
- какие зоны у Карена, Сергея и Василия;
- что нельзя менять без согласования;
- какие ветки использовать;
- какие проверки запускать;
- какие ограничения у MVP.

`.cursor/rules/*.mdc` — это правила, которые Cursor читает внутри проекта.

Важно: эти правила не нужно каждому создавать локально. Они лежат в репозитории.
Когда вы делаете `git pull`, вы получаете актуальные правила. Cursor в вашем
локальном проекте начинает работать с этими правилами.

То есть правила общие для всех. Я как тимлид могу менять их через PR, а вы
получаете их вместе с кодом.

Но нужно понимать: `.cursor/rules` — это не физический запрет на изменение файла.
Cursor технически может изменить что угодно, если вы ему разрешите. Поэтому ваша
ответственность — правильно формулировать задачу и проверять diff.

## 7. Какие Документы Нужно Знать

Не нужно каждый день перечитывать всю документацию. Но нужно понимать, где что
лежит.

Главный вход:

- `SPEC.md`

Командные правила:

- `AGENTS.md`
- `docs/team-process.md`
- `docs/CURSOR_WORKFLOW.md`

Архитектура:

- `docs/ARCHITECTURE.md`

Контракты:

- `docs/CONTRACTS.md`

Локальная разработка:

- `docs/DEVELOPMENT.md`

Проверка текущего поведения:

- `docs/baseline-checklist.md`

Демо:

- `docs/DEMO_RUNBOOK.md`

Если вы не знаете, можно ли менять файл, сначала смотрите `AGENTS.md` и
`docs/ARCHITECTURE.md`. Если всё равно непонятно — спрашиваете меня.

## 8. Что Такое Shared Contracts И Почему Их Нельзя Менять Случайно

У нас есть папка:

```text
shared/src/**
```

Это shared contracts. Там описываются схемы и типы, которые связывают frontend,
backend, renderer, control panel, rundowns и LLM.

Простыми словами: это договор между частями системы.

Если мы меняем структуру template, frontend должен понимать эту структуру,
backend должен валидировать эту структуру, renderer должен уметь её отрисовать,
LLM должен генерировать совместимый JSON.

Поэтому изменение shared-схемы — это не обычная маленькая правка. Это cross-zone
change.

Если кто-то меняет shared contract, в PR должно быть написано:

- что именно изменилось;
- какие frontend-зоны затронуты;
- какие backend-зоны затронуты;
- затронут ли renderer;
- затронут ли LLM;
- можно ли сбросить `data/db.json`;
- какие ручные сценарии проверены.

Без этого shared менять нельзя.

## 9. Как Работать С API И WebSocket

HTTP API и WebSocket — это тоже contracts.

Нельзя просто изменить response backend и поправить только одну страницу.

Если меняется API:

- обновляем backend route;
- обновляем frontend API client;
- проверяем affected UI;
- если нужно, обновляем shared schema;
- описываем это в PR.

Если меняется WebSocket protocol:

- проверяем Control;
- проверяем Renderer;
- проверяем TAKE;
- проверяем UPDATE;
- проверяем CLEAR;
- проверяем late renderer connection, когда renderer открылся после того, как
  графика уже в эфире.

Особенно аккуратно с командами:

- `take`;
- `update`;
- `clear`.

Это demo-critical flow.

## 10. Как Выглядит Нормальный Рабочий День

Пример нормального процесса:

1. Вы берёте задачу.
2. Проверяете, чья это зона.
3. Обновляете базовую ветку.
4. Создаёте feature-ветку.
5. Пишете Cursor хороший промпт с ограничениями.
6. Cursor читает релевантные файлы.
7. Cursor делает изменения.
8. Вы смотрите diff.
9. Если diff полез в чужие зоны — останавливаетесь и разбираетесь.
10. Запускаете проверки.
11. Проверяете UI руками.
12. Просите Cursor сделать commit, если всё нормально.
13. Push.
14. PR.
15. Review.
16. Исправления.
17. Merge через squash.

Это должно стать привычкой.

## 11. Daily Status

Чтобы мы не конфликтовали, каждый пишет короткий статус:

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
What changed today: добавил input opacity в properties panel
Blockers: none
Could affect: editor preview rendering
PR link: пока нет
```

Это нужно не для отчётности ради отчётности, а чтобы мы заранее видели, если два
человека собираются менять один и тот же файл.

## 12. Hot Files

Есть файлы, которые особенно опасно менять параллельно:

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

Если задача требует hot file, сначала предупреждаем команду.

Если два человека должны трогать один hot file, договариваемся о порядке:
сначала один PR, потом второй обновляется от актуальной ветки.

## 13. Что Проверять Перед PR

Минимально перед PR:

```bash
npm run typecheck
npm run build
./start.sh
```

Но этого не всегда достаточно.

Если менялся UI:

- открыть страницу;
- проверить сценарий руками;
- приложить screenshot или видео в PR.

Если менялся Control или Renderer:

- проверить TAKE;
- проверить UPDATE;
- проверить CLEAR;
- проверить renderer URL.

Если менялись Rundowns:

- создать rundown;
- добавить slot;
- поменять порядок;
- reload;
- проверить, что данные сохранились.

Если менялся Editor:

- создать layer;
- изменить свойства;
- сохранить template;
- reload;
- открыть в renderer, если изменение влияет на отображение.

Если менялся shared/API/WS:

- описать contract change;
- проверить backend;
- проверить frontend;
- проверить renderer/control;
- написать, можно ли сбросить `data/db.json`.

## 14. Как Делать PR

PR должен быть маленьким и понятным.

В PR нужно указать:

- что изменилось;
- чья owner-зона;
- какие файлы/зоны затронуты;
- есть ли shared contract changes;
- какие проверки запускались;
- какой ручной сценарий проверен;
- screenshots/video, если менялся UI.

Плохой PR:

- "много разных улучшений";
- 40 файлов из разных зон;
- feature + refactor + форматирование + dependency upgrade;
- нет описания;
- нет проверок;
- есть случайные изменения.

Хороший PR:

- одна задача;
- понятный diff;
- понятная зона;
- проверки пройдены;
- ручной сценарий описан;
- если Cursor что-то сделал — всё равно разработчик понимает, что именно.

## 15. Как Мы Относимся К Рефакторингу

Рефакторинг не запрещён. Но он должен быть осознанным.

Можно рефакторить, если:

- это нужно для задачи;
- это уменьшает реальную сложность;
- это не ломает baseline;
- это не раздувает PR до огромного размера;
- команда понимает последствия.

Нельзя делать "заодно":

- переписать чужую зону;
- поменять shared contracts;
- обновить зависимости;
- поменять структуру backend;
- поменять scripts;
- переехать на другую БД;
- добавить auth;
- изменить WebSocket protocol.

Если хочется большой refactor — сначала обсуждаем, потом отдельная ветка,
отдельный PR и отдельная baseline-проверка.

## 16. Как Мы Относимся К LLM

LLM — это отдельная важная фича, но она не должна ломать ручную работу.

Принцип:

```text
prompt -> llama.cpp -> JSON -> validation -> template draft
```

LLM output нельзя просто сохранять как есть. Он должен пройти validation через
shared schema.

Если llama.cpp недоступен, должен быть fallback. Это важно для демо: если LLM не
поднялся, проект всё равно должен работать.

LLM-зона в основном моя. Если задача Василия или Сергея требует изменить LLM
pipeline, сначала согласуем.

## 17. Как Мы Относимся К DeckLink

DeckLink сейчас best-effort.

Это значит:

- мы не игнорируем его;
- не ломаем очевидно;
- scripts должны оставаться понятными;
- browser renderer остаётся fallback;
- физическая SDI-проверка не блокирует обычную frontend/backend разработку,
  если карты нет.

Если задача напрямую трогает `decklink-out/**`, сначала согласуем.

## 18. Что Делать, Если Cursor Предлагает Что-То Странное

Если Cursor предлагает:

- изменить shared schema в UI-задаче;
- переписать backend ради маленькой кнопки;
- добавить auth;
- поменять базу данных;
- обновить пачку зависимостей;
- сделать большой refactor без просьбы;
- удалить много файлов;
- поменять WebSocket protocol;
- сделать commit/push без просьбы;

нужно остановиться.

Не надо спорить с агентом внутри бесконечного цикла. Нужно сказать:

```text
Остановись. Эта правка выходит за текущую owner-зону.
Объясни, зачем она нужна, какие файлы затронет и можно ли решить задачу без неё.
```

Если после объяснения всё ещё кажется, что изменение нужно, пишете мне.

## 19. Почему Это Всё Важно

Мы используем Cursor, потому что он ускоряет разработку. Но Cursor ускоряет не
только хорошие решения, он так же быстро может ускорить хаос.

Если агенту дать широкую задачу без границ, он может:

- изменить чужие файлы;
- сломать contracts;
- создать большой diff;
- добавить лишнюю сложность;
- починить одну страницу и сломать renderer;
- сделать код, который работает только в одном сценарии.

Наша задача — не отказаться от Cursor, а управлять им правильно.

Cursor должен помогать нам писать код внутри архитектуры, а не каждый раз
изобретать архитектуру заново.

## 20. Финальные Правила, Которые Нужно Запомнить

Первое: работаем в своих зонах.

Второе: если нужно выйти из зоны — сначала спрашиваем.

Третье: shared contracts, API и WebSocket не меняем случайно.

Четвёртое: каждый работает в своей feature-ветке.

Пятое: прямых коммитов в `MVP` нет.

Шестое: Cursor не делает commit/push без явной просьбы.

Седьмое: перед PR запускаем проверки.

Восьмое: UI проверяем руками.

Девятое: PR должен быть маленьким и понятным.

Десятое: проект после изменений должен запускаться и сохранять baseline.

## 21. Что Я Ожидаю От Сергея

Сергей, от тебя я ожидаю, что ты будешь развивать editor-зону:

- улучшать работу со слоями;
- улучшать properties panel;
- улучшать variables;
- улучшать canvas interactions;
- улучшать timeline UI;
- делать editor удобнее и стабильнее.

Но при этом не трогать backend, shared, control, templates page, renderer engine
и DeckLink без согласования.

Если Cursor предлагает выйти за эту границу — останавливаешься и спрашиваешь.

## 22. Что Я Ожидаю От Василия

Василий, от тебя я ожидаю, что ты будешь развивать templates/rundowns/control:

- templates list and CRUD;
- rundowns;
- control workflows;
- channels;
- external integrations;
- удобство оператора.

Но при этом не трогать editor internals, LLM, shared schemas, renderer/timeline
engine и DeckLink без согласования.

Если задача требует contract change — сначала обсуждаем.

## 23. Что Я Беру На Себя

Я беру на себя:

- архитектуру;
- backend foundation;
- shared contracts;
- LLM pipeline;
- Cursor rules;
- CI;
- review;
- merge policy;
- контроль baseline;
- решения по спорным границам.

Если у вас есть сомнение, лучше спросить раньше, чем потом разбирать конфликт в
большом PR.

## 24. Как Будет Выглядеть Хороший Результат

Хороший результат для нас — это не просто "каждый написал код".

Хороший результат:

- Сергей может спокойно развивать editor;
- Василий может спокойно развивать templates/rundowns/control;
- я могу развивать backend/shared/LLM;
- мы не конфликтуем каждый день;
- PR маленькие и понятные;
- Cursor работает по правилам;
- проект запускается;
- demo-сценарии живы;
- команда понимает архитектуру.

Если мы будем так работать, то за короткое время сможем добавить много функций и
не развалить текущий MVP.

## 25. Заключение

Давайте договоримся: мы не пытаемся сделать процесс тяжёлым. Мы делаем его
предсказуемым.

У каждого есть зона. У каждой задачи есть ветка. У каждого PR есть review. У
Cursor есть правила. У проекта есть baseline.

Если мы держим эти пять вещей, мы можем работать параллельно и быстро.

Если мы их игнорируем, мы очень быстро начнём ломать друг другу работу.

Поэтому с этого момента работаем по новой схеме:

```text
Задача -> owner zone -> feature branch -> Cursor with explicit rules -> diff review
-> checks -> manual test -> PR -> Karen review -> squash merge
```

Если что-то непонятно — спрашивайте сразу. Лучше один вопрос до изменения, чем
два дня исправления конфликтов после.

## 26. Короткая Памятка После Встречи

### Для Всех

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

Перед PR:

```bash
npm run typecheck
npm run build
./start.sh
```

### Сергей

Рабочая зона:

```text
frontend/src/features/editor/**
frontend/src/pages/EditorPage.tsx
```

Не менять без вопроса:

```text
shared/**
backend/**
ControlPage
TemplatesPage
renderer/timeline engine
decklink-out/**
```

### Василий

Рабочая зона:

```text
frontend/src/features/templates/**
frontend/src/features/rundowns/**
frontend/src/features/control/**
frontend/src/pages/TemplatesPage.tsx
frontend/src/pages/ControlPage.tsx
backend/src/routes/templates.ts
backend/src/routes/rundowns.ts
backend/src/routes/channels.ts
backend/src/integrations/**
```

Не менять без вопроса:

```text
editor internals
shared/**
LLM pipeline
renderer/timeline engine
decklink-out/**
repo scripts/CI/workspaces
```

### Если Cursor Хочет Выйти За Зону

Сказать агенту:

```text
Остановись. Эта правка выходит за текущую owner-зону.
Объясни, зачем она нужна, какие файлы затронет и можно ли решить задачу без неё.
Не вноси изменения, пока я не подтвержу.
```

### Главная Формула

```text
Маленькая задача + правильная зона + отдельная ветка + понятный PR + ручная проверка
```

Так мы сохраняем скорость и не ломаем MVP.
