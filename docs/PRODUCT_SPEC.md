# Product Spec

Этот документ описывает, что должен уметь Broadcast Graphics как MVP. Это не
полный roadmap, а практическая спецификация текущей demo-critical версии.

## Цель MVP

Дать команде возможность подготовить графические шаблоны, вывести их в эфирный
renderer, управлять live-переменными и показать рабочий broadcast graphics flow
на демо.

## Основные Пользователи

Оператор:

- выбирает шаблон;
- задаёт значения переменных;
- выбирает канал;
- нажимает TAKE/CLEAR/UPDATE;
- работает с рандауном.

Дизайнер/редактор шаблонов:

- создаёт шаблон;
- добавляет слои;
- настраивает свойства;
- создаёт переменные;
- настраивает timeline-анимации;
- сохраняет шаблон.

Тимлид/интегратор:

- настраивает каналы;
- проверяет renderer;
- проверяет DeckLink best-effort;
- подключает LLM/template generation;
- следит за contracts.

## Must-Have Сценарии

### Templates

Система должна позволять:

- видеть список шаблонов;
- создать новый шаблон;
- открыть шаблон в редакторе;
- сохранить изменения;
- продублировать шаблон;
- удалить шаблон;
- импортировать template JSON, если UI это поддерживает.

### Editor

Редактор должен позволять:

- добавлять text layer;
- добавлять rectangle layer;
- добавлять image layer;
- добавлять video layer;
- добавлять clock layer;
- выбирать, двигать и resize-ить слои;
- менять свойства слоя;
- менять порядок слоёв;
- создавать переменные;
- привязывать переменные к свойствам слоя;
- сохранять шаблон;
- открыть сохранённый шаблон после reload.

### Timeline

Timeline должен позволять:

- создавать keyframes для слоя;
- двигать playhead;
- preview-ить анимацию;
- сохранять timeline data внутри шаблона.

Если часть advanced timeline UI временно нестабильна, это нужно явно отметить в
PR или demo runbook.

### Control Panel

Control panel должен позволять:

- выбрать template;
- загрузить template variables;
- изменить live values;
- выбрать channel;
- отправить TAKE;
- отправить UPDATE;
- отправить CLEAR;
- видеть базовое состояние on-air.

### Rundowns

Rundowns должны позволять:

- создать rundown;
- добавить template slot;
- изменить порядок slots;
- сохранить rundown;
- выбрать slot;
- отправить slot on-air;
- clear slot или clear all, если UI это поддерживает;
- сохранить состояние после reload.

### Browser Renderer

Renderer должен:

- подключаться к backend WebSocket;
- получать TAKE/CLEAR/UPDATE;
- показывать template graphics;
- применять variables;
- проигрывать in/out animations;
- сохранять прозрачный background;
- получать replay on-air state при позднем подключении.

### Settings And Channels

Settings должны позволять:

- создать channel;
- отредактировать название;
- выбрать output mode;
- выбрать browser-only/no SDI mode;
- показать renderer URL;
- сохранить настройки.

### Uploads

Uploads должны позволять:

- загрузить изображение;
- загрузить видео;
- использовать загруженный media URL в template layer.

### LLM Template Generation

LLM feature должен:

- принимать текстовое описание шаблона;
- обращаться к локальному llama.cpp server, если он доступен;
- иметь fallback, если LLM недоступен;
- валидировать output через shared schema;
- создавать draft template, пригодный для открытия в editor.

LLM не должен ломать ручное создание шаблонов.

### DeckLink

DeckLink сейчас считается best-effort:

- физическая SDI-проверка не блокирует обычную frontend/backend разработку;
- `decklink-out` не должен получать очевидные syntax/runtime ошибки;
- `start-decklink.sh` должен давать понятный результат;
- browser renderer остаётся главным fallback.

## Non-Goals Для MVP

Пока не делаем без отдельного решения:

- users/auth/roles;
- permissions;
- PostgreSQL или другую сложную БД;
- real deployment platform;
- cloud rendering;
- multi-tenant mode;
- audit log;
- сложную asset library;
- pixel-perfect DeckLink certification.

## Критерии Готовности Фичи

Фича считается готовой, если:

- она работает в UI;
- она не ломает соседние сценарии;
- проходит `npm run typecheck`;
- проходит `npm run build`;
- проект запускается через `./start.sh`;
- ручной сценарий проверен;
- PR описывает affected zones;
- contract changes, если есть, явно описаны.

## Критерии Готовности Foundation

Foundation можно вливать в `MVP`, если:

- все основные страницы открываются;
- templates/editor/control/rundowns/settings/renderer работают на baseline;
- backend и frontend стартуют стабильно;
- shared schemas не расходятся с API;
- команда понимает ownership;
- Cursor rules лежат в репозитории;
- CI проходит.
