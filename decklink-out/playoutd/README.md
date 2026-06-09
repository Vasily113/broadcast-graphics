# playoutd (native SDI playout renderer)

Native process that renders graphics at a fixed frame rate and publishes RGBA frames to the POSIX SHM ring consumed by `decklink-channeld`.

## Architecture

```
Control Panel  →  backend /ws/control  →  playoutd (Unix socket)
                                              ↓ SHM RGBA
                                        decklink-channeld  →  SDI
```

Electron is not used on this path (`DECKLINK_PIPELINE=native-playout`).

## Environment

| Variable | Description |
|----------|-------------|
| `DECKLINK_CHANNEL_ID` | Channel UUID |
| `DECKLINK_SHM_NAME` | SHM name (must match channeld) |
| `DECKLINK_DISPLAY_MODE` | `HD1080i50` (default) or `HD1080p50` |
| `PLAYOUT_CONTROL_SOCKET` | Unix socket path (default `/tmp/bgv13_playout_<channel>.sock`) |

## Build

```bash
cd decklink-out && npm run build-playoutd
```

## Run (manual)

```bash
# Terminal 1: channeld (creates SHM + DeckLink)
DECKLINK_CHANNEL_ID=... DECKLINK_SHM_NAME=bgv13_... ./channeld/decklink-channeld

# Terminal 2: playoutd
DECKLINK_CHANNEL_ID=... DECKLINK_SHM_NAME=bgv13_... ./playoutd/playoutd
```

Or use `./start-decklink.sh` with `DECKLINK_PIPELINE=native-playout`.

## v1 renderer

- **rect** — fill, rounded corners, opacity
- **text** — FreeType (DejaVu Sans Bold by default)
- **image** — PNG from `data/uploads` via `PLAYOUT_UPLOADS_DIR`
- **clock** — basic `HH:mm:ss` formatting
- Variable bindings (`type: variable`) on take/update
- Canvas scale to 1920×1080 output

## Fonts

`playoutd` loads the same project fonts as the editor: `fonts/manifest.json` + `.ttf`/`.otf` under `PLAYOUT_FONTS_DIR` (set by `start-decklink.sh` to `<repo>/fonts`).

Import fonts in the editor (слой «Текст» → **Шрифт** → кнопка импорта). Поле `fontFamily` в шаблоне должно совпадать с именем семейства в manifest.

| Variable | Purpose |
|----------|---------|
| `PLAYOUT_FONTS_DIR` | Project `fonts/` directory |
| `PLAYOUT_FONT_PATH` | Legacy fallback if family not in manifest |
| `PLAYOUT_FONT_BOLD_PATH` | Legacy bold fallback |

Bold: файл `bold` в manifest или `MyFont-Bold.ttf` рядом с regular.

Build dependencies (Ubuntu):

```bash
sudo apt install libpng-dev libfreetype6-dev
cd decklink-out && npm run build-playoutd
```

## Timeline

Animated templates (keyframes, groups, `rootStack`) use the same `timeline-runtime.js` as the editor via a Node child process (`timeline_bridge.js`). On start you should see:

`[playoutd] timeline bridge ready (...)`

Requires `node` on PATH (or `PLAYOUT_NODE`).

Supported: **rotation** (pivot top-left, as PIXI), **rect borders**, blend modes `normal` / `add` / `multiply` / `screen`.

Not yet: video layers, full nested group stack in C++-only path.

## Control protocol

Newline-delimited JSON, same shape as `/ws/control`:

```json
{"type":"take","templateId":"lower-third-1","channelId":"<uuid>"}
{"type":"clear","templateId":"lower-third-1","channelId":"<uuid>"}
```

Backend forwards these automatically when playoutd is listening.
