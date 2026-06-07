# Broadcast Graphics MVP Baseline Checklist

Этот checklist описывает текущее рабочее поведение MVP, которое нельзя ломать
во время foundation/refactor/feature изменений.

Проверка намеренно ручная: цель — доказать, что пользовательские сценарии всё
ещё работают после изменений.

## Start And Stop

Установить зависимости:

```bash
npm install
```

Запустить backend и frontend:

```bash
./start.sh
```

Открыть:

- Frontend: `http://localhost:4000/templates`
- Backend renderer: `http://localhost:4001/renderer.html`
- Control: `http://localhost:4000/control`
- Settings: `http://localhost:4000/settings`

Остановить:

```bash
./stop.sh
```

Pass criteria:

- backend запускается на `4001`;
- frontend запускается на `4000`;
- страницы открываются без crash screen;
- `./stop.sh` освобождает порты.

## Templates

Проверить:

- открыть `Templates`;
- увидеть список шаблонов;
- создать новый template;
- открыть созданный template в editor;
- сохранить template;
- вернуться в список;
- продублировать template, если UI это поддерживает;
- удалить template;
- импортировать template JSON, если есть тестовый файл и UI это поддерживает.

Pass criteria:

- список не падает;
- template сохраняется;
- после reload template остаётся доступен;
- API не возвращает HTML/error вместо JSON.

## Editor

Проверить:

- добавить text layer;
- добавить rectangle layer;
- добавить image layer через upload;
- добавить video layer через upload;
- добавить clock layer;
- выбрать layer;
- drag/resize layer;
- изменить layer properties;
- reorder layers;
- создать variable;
- привязать variable к layer property;
- сохранить template;
- reload template и убедиться, что сохранённое состояние осталось.

Pass criteria:

- canvas работает;
- свойства применяются визуально;
- variables сохраняются;
- uploads отображаются;
- нет fatal runtime errors.

## Timeline

Проверить:

- добавить keyframe для transform/opacity, если UI это поддерживает;
- подвигать playhead;
- preview playback;
- сохранить template;
- открыть template снова.

Pass criteria:

- visible animation changes есть;
- сохранение не ломает template;
- renderer/editor не падают.

## Settings And Channels

Проверить:

- открыть `Settings`;
- создать channel;
- изменить channel name;
- выбрать browser-only/no SDI mode, если DeckLink не нужен;
- изменить output settings;
- сохранить;
- убедиться, что renderer URL показан;
- reload page и проверить, что channel остался.

Pass criteria:

- channels CRUD работает;
- renderer URL соответствует выбранному channel;
- browser-only mode доступен для проверки без DeckLink.

## Control Panel

Проверить:

- открыть `Control`;
- выбрать template;
- изменить variable values;
- выбрать channel;
- нажать TAKE;
- открыть renderer для того же channel;
- убедиться, что template появился;
- изменить variables;
- отправить UPDATE/live update;
- нажать CLEAR;
- убедиться, что template исчез.

Pass criteria:

- WebSocket подключается;
- TAKE показывает графику;
- UPDATE меняет values;
- CLEAR убирает графику;
- renderer не требует reload для обычного сценария.

## Rundowns

Проверить:

- создать rundown;
- добавить template slots;
- изменить порядок slots;
- сохранить или дождаться auto-save;
- использовать NEXT/PREV, если UI это поддерживает;
- отправить slot on-air;
- clear slot или clear all;
- reload page;
- убедиться, что rundown остался доступен.

Pass criteria:

- rundown сохраняется;
- порядок slots сохраняется;
- slot TAKE работает через renderer;
- reload не теряет основные данные.

## Browser Renderer

Открыть:

```text
http://localhost:4001/renderer.html?channel=<channelId>
```

или renderer URL из Settings.

Проверить:

- renderer подключается к backend;
- TAKE из Control отображается;
- CLEAR удаляет графику;
- transparent background сохраняется;
- позднее подключение renderer получает текущий on-air state.

Pass criteria:

- renderer пригоден для OBS/vMix browser source;
- нет видимого debug overlay в production/demo сценарии, если он не нужен;
- active graphics соответствуют Control state.

## Uploads

Проверить:

- загрузить image;
- загрузить video;
- использовать uploaded media в template;
- сохранить template;
- открыть template после reload;
- вывести template в renderer.

Pass criteria:

- media сохраняется в `data/uploads`;
- URL доступен через backend;
- renderer может показать media.

## LLM

Проверить:

- открыть LLM generation UI на странице templates;
- отправить простой prompt;
- если llama.cpp server доступен, получить generated template;
- если llama.cpp недоступен, получить fallback;
- открыть generated/fallback template в editor.

Pass criteria:

- LLM feature не ломает Templates page;
- fallback работает;
- output проходит validation;
- пользователь может продолжить manual editing.

## DeckLink Best-Effort Check

Физическая DeckLink/SDI проверка не обязательна для обычного foundation merge,
если карты нет.

Проверить best-effort:

- `decklink-out` dependencies install;
- `start-decklink.sh` находит backend или сообщает понятную ошибку;
- `decklink-out/src/main.js` не получил очевидную syntax/runtime ошибку;
- native addon build остаётся документирован через `./build-decklink.sh`.

Pass criteria:

- browser renderer остаётся fallback;
- DeckLink-specific failure не блокирует frontend/backend demo;
- ошибки понятны и не маскируются.

## Final Pass Criteria

Foundation/refactor PR можно вливать, если:

- backend и frontend стартуют;
- frontend build/typecheck проходят;
- backend typecheck/build проходят;
- GitHub Actions basic checks зелёные;
- manual flows выше пройдены или явно указаны как not applicable;
- physical DeckLink output не обязателен, если нет доступа к железу;
- intentional behavior changes описаны в PR;
- contract changes описаны в PR.
