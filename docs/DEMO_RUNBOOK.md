# Demo Runbook

Этот документ нужен для подготовки и проведения демо. Его задача — быстро
получить рабочее состояние проекта и знать, что делать, если часть системы не
поднялась.

## За День До Демо

1. Перейти на актуальную demo-ветку.
2. Установить зависимости:

```bash
npm install
```

3. Проверить сборку:

```bash
npm run typecheck
npm run build
```

4. Запустить проект:

```bash
./start.sh
```

5. Пройти `docs/baseline-checklist.md`.
6. Подготовить 2-3 demo templates.
7. Подготовить минимум 1 rundown.
8. Проверить renderer URL.
9. Если нужен LLM, проверить llama.cpp server.
10. Если нужен SDI, отдельно проверить DeckLink.

## За 30 Минут До Демо

1. Закрыть лишние dev servers.
2. Остановить старые процессы:

```bash
./stop.sh
```

3. Запустить проект:

```bash
./start.sh
```

4. Открыть страницы:

- `http://localhost:4000/templates`
- `http://localhost:4000/control`
- `http://localhost:4000/settings`
- `http://localhost:4001/renderer.html?channel=<channelId>`

5. Проверить один TAKE/CLEAR.
6. Проверить один rundown slot.
7. Оставить renderer открытым.

## Рекомендуемый Сценарий Показа

1. Открыть `Templates`.
2. Показать список шаблонов.
3. Создать или открыть существующий шаблон.
4. В editor показать:
   - text layer;
   - image/video layer;
   - variables;
   - простую animation/timeline.
5. Сохранить шаблон.
6. Перейти в `Control`.
7. Выбрать template.
8. Изменить variable values.
9. Нажать TAKE.
10. Показать renderer.
11. Сделать UPDATE live values.
12. Сделать CLEAR.
13. Показать rundown flow.
14. Если стабильно, показать LLM generation.
15. Если доступен SDI, показать DeckLink output.

## Fallback: LLM Не Работает

Если llama.cpp server не отвечает:

- не тратить время на дебаг во время демо;
- показать fallback generation;
- сказать, что интеграция поддерживает local llama.cpp, а сейчас работает
  deterministic fallback;
- продолжить ручной editor/control сценарий.

LLM не должен блокировать основной demo flow.

## Fallback: DeckLink Не Работает

Если физический SDI output не поднялся:

- использовать browser renderer;
- открыть renderer URL в браузере или OBS/vMix browser source;
- показать прозрачный background и TAKE/CLEAR/UPDATE;
- отметить, что DeckLink output находится в best-effort режиме.

DeckLink не должен блокировать software demo.

## Fallback: Port Занят

```bash
./stop.sh
./start.sh
```

Если не помогло, выяснить процесс, который держит порт `4000` или `4001`.
Не менять порты во время демо, если можно просто остановить старый процесс.

## Fallback: Templates Page Упала

Проверить backend:

```bash
curl http://localhost:4001/api/templates
```

Если backend не отвечает:

```bash
./stop.sh
./start.sh
```

Если API возвращает ошибку, открыть `data/db.json` только после демо или
переключиться на заранее подготовленный clean DB, если он есть.

## Fallback: Renderer Не Показывает Графику

Проверить:

- правильный `channelId`;
- Control отправляет TAKE именно на этот channel;
- renderer подключен к backend;
- backend запущен;
- browser console без критичных ошибок.

Быстрая проверка:

1. Создать browser-only channel.
2. Открыть renderer URL из Settings.
3. В Control выбрать тот же channel.
4. Нажать TAKE.

## Что Не Показывать, Если Нестабильно

Не показывать в demo, если не проверено заранее:

- физический DeckLink output;
- сложные timeline combinations;
- неподготовленные imported templates;
- LLM generation с большим prompt без fallback;
- случайные media uploads большого размера.

## После Демо

1. Остановить процессы:

```bash
./stop.sh
```

2. Записать, что сработало и что сломалось.
3. Создать issues/tasks.
4. Не чинить всё в одной ветке: разбить на feature/fix PR.
