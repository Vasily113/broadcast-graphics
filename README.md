# broadcast-graphics

Система вывода графических титров в прямой эфир. Поддерживает вывод через SDI (Blackmagic DeckLink) с Fill+Key, через браузерный источник OBS/vMix, а также предварительный просмотр в браузере. Управление ведётся через веб-интерфейс.

---

## Содержание

1. [Архитектура](#архитектура)
2. [Технологический стек](#технологический-стек)
3. [Структура проекта](#структура-проекта)
4. [Компоненты](#компоненты)
   - [Backend](#backend)
   - [Frontend](#frontend)
   - [decklink-out](#decklink-out)
5. [Поток данных](#поток-данных)
6. [Протокол WebSocket](#протокол-websocket)
7. [Система шаблонов](#система-шаблонов)
8. [DeckLink интеграция](#decklink-интеграция)
9. [Каналы вывода](#каналы-вывода)
10. [Запуск проекта](#запуск-проекта)
11. [Сборка DeckLink аддона](#сборка-decklink-аддона)
12. [Справочник API](#справочник-api)

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                        ОПЕРАТОР                                 │
│              http://localhost:3000/control                      │
│                     (Control Panel)                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket /ws/control
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND  :3001                              │
│  Express + express-ws                                           │
│                                                                 │
│  onAirState: channelId → Map<templateId, command>               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  /ws/control │  │/ws/renderer  │  │  REST API    │          │
│  │  (from UI)   │─▶│(to renderers)│  │  /api/*      │          │
│  └─────────────┘  └──────────────┘  └──────────────┘          │
│                         │                                       │
│  lowdb → data/db.json   │                                       │
└─────────────────────────┼───────────────────────────────────────┘
                          │ команды: take / clear / update
         ┌────────────────┴────────────────┐
         ▼                                 ▼
┌─────────────────┐              ┌──────────────────────────────┐
│  RENDERER (OBS) │              │  decklink-out (Electron)     │
│  /renderer.html │              │  per channel, CHANNEL_ID env │
│  PIXI.js + GSAP │              │                              │
│  browser source │              │  Offscreen BrowserWindow     │
│  (transparent)  │              │  → PIXI.js рендеринг         │
└─────────────────┘              │  → DeckLink addon (C++)      │
                                 │  → SDI Fill + Key выход      │
                                 └──────────────────────────────┘
```

Полный жизненный цикл команды «выдать в эфир»:

```
Оператор нажимает TAKE
  → Control Panel отправляет по WS: { type:'take', templateId, template, variables, channelId }
  → Backend сохраняет в onAirState[channelId][templateId]
  → Backend рассылает всем renderer-клиентам этого channelId
  → renderer.html / RendererPage: создаёт PIXI-объекты, проигрывает анимацию In
  → decklink-out: scheduleFrame() подаёт каждый кадр (BGRA bitmap) в DeckLink SDK
  → SDI: Fill (цвет) + Key (альфа) на выходе карточки
```

---

## Технологический стек

### Backend
| Технология | Версия | Роль |
|-----------|--------|------|
| Node.js | LTS | Среда выполнения |
| Express 4 | ^4.18 | HTTP-сервер |
| express-ws | ^5.0 | WebSocket поверх Express |
| lowdb 7 | ^7.0 | JSON-база данных (`data/db.json`) |
| multer | ^2.1 | Загрузка файлов (изображения, видео) |
| uuid | ^11 | Генерация UUID для шаблонов, каналов, слотов |

### Frontend (Control Panel + Editor)
| Технология | Версия | Роль |
|-----------|--------|------|
| React 18 | ^18.2 | UI |
| TypeScript 5 | ^5.4 | Типизация |
| Vite 5 | ^5.2 | Сборщик + dev-сервер |
| React Router 6 | ^6.22 | Маршрутизация |
| Zustand | ^4.5 | Стейт-менеджмент редактора |
| zundo | ^2.2 | Undo/redo поверх Zustand |
| PIXI.js 7 | ^7.4 | Рендеринг шаблонов (Editor preview + RendererPage) |
| GSAP 3 | ^3.12 | Анимации In/Out |
| @dnd-kit | ^6/8 | Drag & Drop в редакторе и списке рандаунов |
| Tailwind CSS 3 | ^3.4 | Стилизация |
| lucide-react | ^0.368 | Иконки |

### decklink-out
| Технология | Версия | Роль |
|-----------|--------|------|
| Electron | ^28.3 | Хост для offscreen-рендеринга |
| node-addon-api (N-API) | ^7.1 | Обёртка для C++ аддона |
| node-gyp | ^10 | Сборка нативного аддона |
| Blackmagic DeckLink SDK 16 | — | Вывод видео через SDI |
| MSVC v143 | — | Компилятор C++ (Windows) |

---

## Структура проекта

```
broadcast-graphics/
│
├── start.bat                    # Запуск всех компонентов одной командой
│
├── backend/                     # Express-сервер (порт 3001)
│   ├── package.json
│   ├── src/
│   │   ├── index.js             # Точка входа: HTTP + WebSocket, маршрутизация команд
│   │   ├── db.js                # Инициализация lowdb, экспорт getDb()
│   │   └── routes/
│   │       ├── templates.js     # CRUD шаблонов
│   │       ├── channels.js      # CRUD каналов DeckLink
│   │       ├── rundowns.js      # CRUD рандаунов + POST /reorder
│   │       ├── settings.js      # Глобальные настройки DeckLink (fallback)
│   │       ├── uploads.js       # Загрузка медиафайлов (multer)
│   │       └── control.js       # Устаревший in-memory статус (legacy)
│   └── public/
│       ├── renderer.html        # Standalone renderer для DeckLink (Electron)
│       ├── pixi.min.js          # PIXI.js 7 (bundled, не CDN)
│       └── gsap.min.js          # GSAP 3 (bundled, не CDN)
│
├── frontend/                    # React SPA (порт 3000)
│   ├── package.json
│   ├── vite.config.ts           # Dev-proxy: /api, /ws, /uploads → :3001
│   ├── tailwind.config.js       # Тема: surface-* + accent-*
│   ├── index.html
│   └── src/
│       ├── main.tsx             # Точка входа, React Router
│       ├── index.css            # Tailwind directives + базовые стили
│       ├── core/
│       │   ├── schema.ts        # TypeScript-типы всей системы шаблонов
│       │   ├── renderer.ts      # TemplateRenderer — PIXI.js движок
│       │   └── store.ts         # Zustand-стор редактора (undo/redo)
│       ├── features/
│       │   ├── editor/          # Панели редактора
│       │   │   ├── CanvasArea.tsx       # PIXI-канвас, drag/resize слоёв
│       │   │   ├── LayersPanel.tsx      # Список слоёв
│       │   │   ├── PropertiesPanel.tsx  # Свойства выбранного слоя
│       │   │   ├── VariablesPanel.tsx   # Управление переменными шаблона
│       │   │   ├── AnimationPanel.tsx   # Keyframe-анимации In/Out
│       │   │   └── EditorToolbar.tsx    # Панель инструментов
│       │   └── templates/
│       │       └── TemplateThumbnail.tsx # Миниатюра шаблона (PIXI offscreen)
│       ├── pages/
│       │   ├── TemplatesPage.tsx  # /templates — галерея шаблонов
│       │   ├── EditorPage.tsx     # /editor/:id — редактор шаблона
│       │   ├── ControlPage.tsx    # /control — пульт оператора
│       │   ├── RendererPage.tsx   # /renderer — браузерный рендерер
│       │   └── SettingsPage.tsx   # /settings — настройки каналов DeckLink
│       └── ui/
│           └── toast.tsx          # Уведомления
│
├── decklink-out/                # Electron-приложение вывода на SDI
│   ├── package.json
│   ├── src/
│   │   └── main.js              # Electron main process
│   └── addon/
│       ├── binding.gyp          # Сборка аддона (MSVC v143, C++17)
│       ├── decklink.cpp         # N-API аддон: open/scheduleFrame/close
│       ├── include/
│       │   ├── DeckLinkAPI_manual.h   # Ручная C++ трансляция DeckLink SDK 16
│       │   ├── DeckLinkAPI.idl        # Оригинальный IDL SDK (справочный)
│       │   ├── DeckLinkAPIModes.idl
│       │   └── DeckLinkAPITypes.idl
│       └── build/Release/
│           └── decklink.node    # Скомпилированный нативный аддон
│
└── data/
    ├── db.json                  # База данных (шаблоны, каналы, рандауны)
    └── uploads/                 # Загруженные медиафайлы
```

---

## Компоненты

### Backend

**`backend/src/index.js`** — центральный файл сервера. Содержит весь WebSocket-слой и связывает компоненты.

Ключевые структуры данных (in-memory, живут пока работает процесс):

```js
const rendererClients = new Map();  // channelId → Set<WebSocket>
const onAirState      = new Map();  // channelId → Map<templateId, command>
```

Два WebSocket-эндпоинта:

- **`/ws/control`** — подключается Control Panel. Принимает команды `take`/`clear`/`update`, обновляет `onAirState`, рассылает рендерерам нужного канала.
- **`/ws/renderer`** — подключается каждый рендерер (параметр `?channel=uuid`). При подключении немедленно получает replay всего текущего `onAirState` своего канала — это гарантирует восстановление картинки при переподключении.

**`backend/src/db.js`** — singleton lowdb. Файл `data/db.json` хранит:

```json
{
  "templates": [...],   // шаблоны (id, name, data, created_at, updated_at)
  "channels":  [...],   // каналы DeckLink (id, name, device_index, display_mode, keyer_mode)
  "rundowns":  [...],   // рандауны (id, name, slots[], channelId, created_at, updated_at)
  "settings":  {...}    // глобальные настройки DeckLink (fallback если каналов нет)
}
```

**Маршруты REST API:**

| Файл | Префикс | Описание |
|------|---------|----------|
| `templates.js` | `/api/templates` | CRUD шаблонов; GET `/` возвращает только метаданные (без `data`), GET `/:id` — полный объект |
| `channels.js` | `/api/channels` | CRUD каналов; max 8 каналов |
| `rundowns.js` | `/api/rundowns` | CRUD рандаунов + `POST /reorder` для перестановки порядка |
| `settings.js` | `/api/settings` | GET/PUT глобальных настроек DeckLink |
| `uploads.js` | `/api/uploads` | POST — загрузка файла через multer; поддерживаются image/*, video/webm, video/mp4 (до 200 МБ) |
| `index.js` | `/api/onair` | GET — текущее состояние эфира `{channelId: [templateId, ...]}` |

Статические файлы: `/uploads/*` → `data/uploads/`, корень `/` → `backend/public/` (включая `renderer.html`).

---

### Frontend

Dev-сервер (Vite, порт 3000) проксирует `/api`, `/ws`, `/uploads`, `/renderer.html`, `/pixi.min.js`, `/gsap.min.js` на бэкенд `:3001`.

#### Маршруты

| URL | Компонент | Назначение |
|-----|-----------|-----------|
| `/` | redirect | → `/templates` |
| `/templates` | `TemplatesPage` | Галерея шаблонов |
| `/editor/:id` | `EditorPage` | Редактор шаблона |
| `/control` | `ControlPage` | Пульт оператора |
| `/renderer` | `RendererPage` | Браузерный рендерер (OBS browser source) |
| `/settings` | `SettingsPage` | Настройки DeckLink-каналов |

#### `core/schema.ts` — типы системы шаблонов

Определяет все структуры данных шаблона:

```
Template
  ├── canvas: { width, height, background }
  ├── variables: Variable[]         // text | image | number | color | video
  ├── layers: Layer[]
  │     ├── TextLayer               // PIXI.Text
  │     ├── ImageLayer              // PIXI.Sprite + texture
  │     ├── RectLayer               // PIXI.Graphics
  │     ├── ClockLayer              // PIXI.Text + setInterval (часы / таймер)
  │     └── VideoLayer              // HTMLVideoElement → PIXI.Sprite
  └── tracks: AnimationTrack[]
        └── { layerId, inKeyframes[], outKeyframes[] }
              └── Keyframe: { time(ms), properties, fromProperties, easing }
```

Переменные (`Variable`) могут быть привязаны к свойствам слоёв через `VariableBinding`:
```ts
{ type: 'variable', variableId: string }
```
Это позволяет оператору менять текст/картинку на лету, не трогая структуру шаблона.

#### `core/renderer.ts` — TemplateRenderer

Класс `TemplateRenderer` инкапсулирует весь PIXI.js рендеринг:

- **`syncTemplate(template, variables)`** — диффит текущее состояние PIXI-объектов с описанием шаблона. Создаёт новые объекты при необходимости, удаляет старые. Вызывается при каждом `update`-команде.
- **`playIn(template)`** — запускает GSAP-таймлайн анимации появления (in-keyframes).
- **`playOut(template, onComplete)`** — анимация ухода; по завершении вызывает `onComplete` → уничтожение объектов.
- **`destroy()`** — очищает PIXI, отменяет таймеры, освобождает видео-элементы.

Особенности:
- Автозагрузка Google Fonts для нестандартных шрифтов (через `document.fonts.load`)
- `ClockLayer` использует `setInterval(1000)` внутри рендерера
- Видео (`VideoLayer`) использует `HTMLVideoElement` → `PIXI.Texture.from(el)`; поддерживает loop, muted, autoplay
- `fit: 'cover'` реализуется через маску `PIXI.Graphics`

#### `core/store.ts` — Zustand + zundo

Стор редактора с полным undo/redo (до 50 шагов). Хранит:
- `template` — редактируемый шаблон
- `savedTemplate` — последняя сохранённая версия (для определения `isDirty`)
- `selectedLayerIds`, `tool`, `zoom`, `previewMode`, `snapToGrid`, `gridSize`

Экспортирует все мутаторы: `addLayer`, `updateLayer`, `deleteLayer`, `reorderLayers`, `alignLayers`, `addVariable`, `setTrack` и др.

#### `ControlPage.tsx` — пульт оператора

Центральный файл управления эфиром. Содержит:

**WebSocket-хук `useControlWs()`** (определён внутри файла):
- Подключается к `/ws/control`
- Авто-реконнект каждые 3 секунды при разрыве
- Экспортирует `send(command)`, `status`, `reconnect`

**Состояние:**
```
onAirSet    : Set<string>  // все templateId/slotId в эфире (любой канал)
rdOnAirSet  : Set<string>  // slotId рандаунов в эфире
rundowns    : RundownData[] // список рандаунов (из /api/rundowns)
channels    : Channel[]     // список каналов (из /api/channels)
```

При монтировании делает `Promise.all([/api/rundowns, /api/onair])` и восстанавливает `onAirSet`/`rdOnAirSet` — состояние эфира не теряется при переходе между страницами.

**Две вкладки:**
1. **Templates** — список шаблонов в виде карточек с превью. Оператор выбирает канал через `ChannelBadge`, редактирует переменные, нажимает TAKE/CLEAR/UPDATE.
2. **Rundowns** — пошаговый сценарий. Левая панель — список рандаунов (drag & drop через @dnd-kit). Правая — слоты активного рандауна (тоже drag & drop). Кнопки PREV/NEXT/TAKE/CLEAR-ALL.

**Drag & drop рандаунов:**
- `SortableRundownItem` + `DndContext` → после drop вызывает `POST /api/rundowns/reorder`
- `SortableRundownRow` (слоты внутри рандауна) → порядок сохраняется через автосохранение `PUT /api/rundowns/:id`

#### `RendererPage.tsx` — браузерный рендерер

Подключается к `/ws/renderer?channel=...` (канал из URL-параметра или 'default').

На каждую команду `take` создаёт новый `TemplateRenderer` на отдельном `<canvas>`. На `clear` — вызывает `playOut()`, затем `destroy()`. На `update` — `syncTemplate()`.

Прозрачный фон (`background: transparent`) — страница используется как **Browser Source** в OBS/vMix.

В dev-режиме показывает HUD с WS-статусом и счётчиком активных график.

#### `SettingsPage.tsx` — настройки каналов

CRUD для DeckLink-каналов. Каждый канал:
- **Название** — произвольное
- **SDI выход** — `device_index`:
  - `-1` → Нет (только браузер/OBS) — поля display_mode и keyer_mode скрываются
  - `0` → Sub-device 0: SDI 1 (Fill) + SDI 2 (Key)
  - `1` → Sub-device 1: SDI 5 (Fill) + SDI 6 (Key)
- **Формат вывода** — `HD1080i50`, `HD1080p25`, `HD720p50` и др. (14 режимов)
- **Режим кейера** — `external` (SDI Fill+Key), `internal` (ключ внутри карты), `fill_only`

Страница показывает готовую команду для запуска `decklink-out` и Renderer URL для OBS.

---

### decklink-out

Electron-приложение, по одному экземпляру на канал. Запускается с переменной окружения `CHANNEL_ID`.

#### `src/main.js` — Electron main process

1. Устанавливает GPU-флаги (ANGLE/D3D11 — аппаратное ускорение вместо SwiftShader).
2. Загружает `addon/build/Release/decklink.node`.
3. Запрашивает настройки канала: `GET /api/channels/:CHANNEL_ID` (или `/api/settings` как fallback).
4. Если `device_index !== -1` → вызывает `decklink.open(deviceIndex, displayMode, keyerMode)`.
5. Создаёт offscreen `BrowserWindow` (невидимое окно с `offscreen: true`) разрешением 1920×1080 (или 1280×720 для 720p).
6. Загружает `renderer.html?channel=CHANNEL_ID`.
7. На каждый `paint`-event (кадр от Chromium) вызывает `decklink.scheduleFrame(bitmap)`.
8. FPS устанавливается через `webContents.setFrameRate()` в зависимости от display_mode (25, 30, 50, 60).
9. Логирует FPS каждые 5 секунд.

**Профиль DeckLink:** требует профиль `'2dfd'` (2 Sub-Devices Full Duplex) — единственный профиль на 8K Pro, поддерживающий external keying. При несоответствии (`'4dhd'`) переключает профиль через SDK и бросает исключение `"restart"` → `start.bat` перезапускает Electron через 6 секунд с правильным профилем.

#### `addon/decklink.cpp` — N-API аддон

Экспортирует три функции в JavaScript:

**`open(deviceIndex, displayModeId, keyerMode)`:**
1. Инициализирует COM (`CoInitializeEx`).
2. Проверяет профиль DeckLink через `IDeckLinkProfileManager` → если не `'2dfd'`, вызывает `SetActive()` и бросает ошибку `"restart"`.
3. Перебирает sub-devices через `IDeckLinkIterator`, фильтрует входные устройства через `DoesSupportVideoMode()`.
4. Открывает нужный sub-device по индексу.
5. Инициализирует `IDeckLinkOutput` → `EnableVideoOutput()`.
6. Если keyer_mode ≠ `fill_only`: получает `IDeckLinkKeyer` → `Enable(isExternal)` + `SetLevel(255)`.
7. Создаёт preroll-буфер (3 пустых кадра) для стабилизации вывода.
8. Запускает `StartScheduledPlayback()`.

**`scheduleFrame(buffer)`:**
- Принимает BGRA bitmap от Electron.
- Конвертирует BGRA → ARGB (in-place, SIMD-совместимо через uint32_t swap).
- Вызывает `ScheduleVideoFrame()` с текущим временем по `GetHardwareReferenceClock()`.

**`close()`:**
- `StopScheduledPlayback()` → `DisableVideoOutput()` → Release всех COM-объектов → `CoUninitialize()`.

**`addon/include/DeckLinkAPI_manual.h`** — ручная C++ трансляция DeckLink SDK 16.0 IDL-файлов. Содержит все COM-интерфейсы и константы, необходимые аддону, без зависимости от `.tlb` или зарегистрированного SDK.

---

## Поток данных

### Выдача шаблона в эфир (Templates tab)

```
1. Оператор выбирает шаблон → ControlPage загружает полный template через GET /api/templates/:id
2. Оператор задаёт переменные (текст, картинка, цвет)
3. Оператор выбирает канал через ChannelBadge
4. Оператор нажимает TAKE:
   send({ type:'take', templateId, template, variables, channelId })
   setOnAirSet(prev => new Set(prev).add(templateId))
5. Backend получает по /ws/control:
   onAirState[channelId].set(templateId, command)
   → рассылает всем ws-клиентам rendererClients[channelId]
6. renderer.html / RendererPage получают команду:
   → new TemplateRenderer(canvas, w, h)
   → syncTemplate(template, variables)
   → playIn(template)    // GSAP анимация появления
7. decklink-out: paint event → scheduleFrame(bitmap)
8. SDI: Fill = RGB кадр, Key = Alpha канал
```

### CLEAR

```
Оператор нажимает CLEAR:
  send({ type:'clear', templateId, channelId })
  setOnAirSet(prev => { prev.delete(templateId); return new Set(prev) })
Backend:
  onAirState[channelId].delete(templateId)
  → рассылает renderers
Renderer:
  playOut(template, () => { renderer.destroy(); canvas.remove() })
```

### UPDATE (live-редактирование переменных в эфире)

```
Оператор меняет переменную (debounce 400ms):
  send({ type:'update', templateId, variables, channelId })
Backend:
  onAirState[channelId].set(templateId, {...existing, variables})
  → рассылает renderers
Renderer:
  syncTemplate(template, newVariables)    // без playIn, мгновенно
```

### Rundown (пошаговый сценарий)

Слот рандауна — это обёртка над шаблоном с собственным `slotId` и локальными переменными. При TAKE команда отправляется с `templateId = slotId` (не templateId шаблона), что позволяет одновременно держать в эфире один и тот же шаблон в нескольких рандаунах.

---

## Протокол WebSocket

### `/ws/control` (Control Panel → Backend)

```jsonc
// Выдача
{ "type": "take", "templateId": "uuid", "template": {...}, "variables": {"varId": "value"}, "channelId": "uuid" }

// Убрать
{ "type": "clear", "templateId": "uuid", "channelId": "uuid" }

// Обновить переменные (live)
{ "type": "update", "templateId": "uuid", "variables": {"varId": "value"}, "channelId": "uuid" }
```

`channelId` — UUID канала из настроек. Если не указан → `"default"`.

### `/ws/renderer?channel=uuid` (Backend → Renderer)

Те же команды, только в обратную сторону. При подключении рендерер получает **replay** всех текущих `take`-команд своего канала (из `onAirState`).

---

## Система шаблонов

Шаблон — JSON-документ, содержащий:

### Слои (layers)

| Тип | PIXI-объект | Ключевые свойства |
|-----|-------------|-------------------|
| `text` | `PIXI.Text` | content, style (fontFamily, fontSize, fill, stroke, shadow) |
| `image` | `PIXI.Sprite` | src (URL или variable), fit (stretch/contain/cover), cornerRadius |
| `rect` | `PIXI.Graphics` | fill (цвет или variable), cornerRadius, border |
| `clock` | `PIXI.Text` | mode (clock/countup/countdown), format (HH:mm:ss), startTime/targetTime |
| `video` | `PIXI.Sprite` (HTMLVideoElement) | src, loop, fit |

Все слои имеют: `transform` (x, y, width, height, rotation, scaleX, scaleY, anchorX, anchorY), `opacity`, `blendMode`, `visible`, `locked`.

### Переменные (variables)

```ts
{ id: "v1", name: "headline", label: "Заголовок", type: "text", defaultValue: "Текст" }
```

Привязка к свойству слоя:
```ts
// Вместо строки:
content: "Жёстко заданный текст"
// Привязка к переменной:
content: { type: "variable", variableId: "v1" }
```

Оператор может менять значения переменных прямо в Control Panel без редактирования шаблона.

### Анимации (tracks)

```ts
{
  layerId: "layer-uuid",
  inKeyframes: [
    { time: 500, properties: { alpha: 1, x: 200 }, fromProperties: { alpha: 0, x: 100 }, easing: "power2.out" }
  ],
  outKeyframes: [
    { time: 300, properties: { alpha: 0 }, easing: "power2.in" }
  ]
}
```

GSAP проигрывает все треки одновременно (`.to(obj, {...}, 0)`).

---

## DeckLink интеграция

### Профили карточки (DeckLink 8K Pro)

| Профиль | FourCC | Sub-devices | External Keyer |
|---------|--------|-------------|----------------|
| 2 Sub-Devices Full Duplex | `'2dfd'` | 4 (out0, in0, out1, in1) | ✅ Да |
| 4 Sub-Devices Half Duplex | `'4dhd'` | 4 (все output) | ❌ Нет |

Система требует `'2dfd'`. Sub-devices фильтруются через `DoesSupportVideoMode()` — входные порты пропускаются автоматически:
- **Sub-device 0** → SDI 1 (Fill) + SDI 2 (Key)
- **Sub-device 1** → SDI 5 (Fill) + SDI 6 (Key)

### Автопереключение профиля

При первом запуске на карточке с профилем `'4dhd'`:
1. `decklink.open()` обнаруживает несоответствие
2. Переключает на `'2dfd'` через `IDeckLinkProfile::SetActive()`
3. Бросает ошибку `"restart"` → Electron завершается
4. `start.bat` ждёт 6 секунд и перезапускает Electron
5. При втором запуске профиль уже `'2dfd'` → нормальный старт

### Режимы кейера

| Значение | Поведение |
|----------|-----------|
| `external` | Fill на SDI 1/5, Key (альфа) на SDI 2/6 — врезается в видеосигнал аппаратным образом |
| `internal` | Шейдер кейера внутри карточки, выход на SDI 1/5 |
| `fill_only` | Только Fill, без Key |

---

## Каналы вывода

Система поддерживает до 8 независимых каналов. Каждый канал:
- Имеет собственный `CHANNEL_ID` (UUID)
- Хранит настройки в `data/db.json` (device_index, display_mode, keyer_mode)
- Обслуживается отдельным процессом `decklink-out`
- Имеет отдельный Renderer URL: `http://localhost:3001/renderer.html?channel=UUID`
- Рандауны и шаблоны можно привязывать к конкретному каналу

Если `device_index = -1` → канал работает только через браузер/OBS, DeckLink не задействуется.

---

## Запуск проекта

### Требования

- Windows 10/11 (из-за DeckLink)
- Node.js 20+ LTS
- Blackmagic DeckLink карточка + Desktop Video 16.x (для SDI вывода)

### Первый запуск

```bat
# 1. Установить зависимости backend
cd backend && npm install && cd ..

# 2. Установить зависимости frontend
cd frontend && npm install && cd ..

# 3. Установить зависимости decklink-out
cd decklink-out && npm install && cd ..

# 4. Собрать нативный аддон (см. раздел ниже)
cd decklink-out\addon && node node-gyp rebuild ...

# 5. Запустить всё
start.bat
```

### `start.bat`

Запускает четыре окна CMD:

```bat
# 1. Backend (Express + WS) на порту 3001
start "Backend" cmd /k "cd /d D:\broadcast-graphics\backend && npm start"

# 2. Frontend (Vite dev-сервер) на порту 3000
start "Frontend" cmd /k "cd /d D:\broadcast-graphics\frontend && npm run dev"

# 3. DeckLink Channel 1 (первый запуск — переключение профиля, второй — рабочий)
start "DeckLink Ch1" cmd /k "cd /d D:\broadcast-graphics\decklink-out && set CHANNEL_ID=<uuid-ch1>&& node_modules\electron\dist\electron.exe . & timeout /t 6 /nobreak > nul & node_modules\electron\dist\electron.exe ."

# 4. DeckLink Channel 2
start "DeckLink Ch2" cmd /k "cd /d D:\broadcast-graphics\decklink-out && set CHANNEL_ID=<uuid-ch2>&& node_modules\electron\dist\electron.exe . & timeout /t 6 /nobreak > nul & node_modules\electron\dist\electron.exe ."
```

> **Важно:** в команде `set` нет пробела перед `&&` — это намеренно. Windows CMD включает пробел в значение переменной, что ломает URL.

После запуска:
- **Control Panel:** http://localhost:3000/control
- **Settings:** http://localhost:3000/settings
- **Renderer (для OBS):** `http://localhost:3001/renderer.html?channel=<uuid>` (или через порт 3000 в dev)

---

## Сборка DeckLink аддона

Требуется: Visual Studio 2022 (MSVC v143), Python 3, node-gyp.

```bat
cd decklink-out

# Сборка для текущей версии Electron (28.x = Node.js ABI 121)
npm run build-addon
# Эквивалентно:
# cd addon && node node-gyp rebuild --arch=x64 --target=28.3.3 --dist-url=https://electronjs.org/headers
```

Перед перестройкой обязательно закрыть все процессы `electron.exe` — иначе `decklink.node` заблокирован и линковка завершится с `LNK1104`.

При ошибке `LNK1103` (corrupt debug info) удалить:
```
decklink-out\addon\build\Release\obj\decklink\decklink.obj
decklink-out\addon\build\Release\obj\decklink\decklink.iobj
```

Результат: `decklink-out\addon\build\Release\decklink.node`

---

## Справочник API

### Templates

| Метод | URL | Тело | Описание |
|-------|-----|------|----------|
| GET | `/api/templates` | — | Список шаблонов (без `data`), сортировка по `updated_at DESC` |
| GET | `/api/templates/:id` | — | Полный шаблон с `data` |
| POST | `/api/templates` | `{name, data}` | Создать шаблон |
| PUT | `/api/templates/:id` | `{name?, data?}` | Обновить шаблон |
| DELETE | `/api/templates/:id` | — | Удалить шаблон |

### Channels

| Метод | URL | Тело | Описание |
|-------|-----|------|----------|
| GET | `/api/channels` | — | Список каналов (сортировка по `created_at ASC`) |
| GET | `/api/channels/:id` | — | Один канал |
| POST | `/api/channels` | `{name, device_index, display_mode, keyer_mode}` | Создать канал (max 8) |
| PUT | `/api/channels/:id` | любые поля канала | Обновить канал |
| DELETE | `/api/channels/:id` | — | Удалить канал |

### Rundowns

| Метод | URL | Тело | Описание |
|-------|-----|------|----------|
| GET | `/api/rundowns` | — | Список рандаунов в хранимом порядке |
| GET | `/api/rundowns/:id` | — | Один рандаун |
| POST | `/api/rundowns` | `{name, slots?, channelId?}` | Создать рандаун |
| PUT | `/api/rundowns/:id` | `{name?, slots?, channelId?}` | Обновить рандаун |
| DELETE | `/api/rundowns/:id` | — | Удалить рандаун |
| POST | `/api/rundowns/reorder` | `{ids: string[]}` | Переставить рандауны |

### Uploads

| Метод | URL | Тело | Описание |
|-------|-----|------|----------|
| POST | `/api/uploads` | `multipart/form-data` поле `file` | Загрузить файл; возвращает `{url: "/uploads/filename"}` |

### On-air state

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/onair` | Текущее состояние эфира: `{channelId: [templateId, ...]}` |

### Settings (global fallback)

| Метод | URL | Тело | Описание |
|-------|-----|------|----------|
| GET | `/api/settings` | — | Глобальные настройки DeckLink |
| PUT | `/api/settings` | `{display_mode?, keyer_mode?, device_index?}` | Обновить настройки |
