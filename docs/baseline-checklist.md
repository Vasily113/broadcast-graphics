# Broadcast Graphics MVP Baseline Checklist

This checklist describes the current working MVP behavior that must survive the
foundation refactor. It is intentionally manual: the goal is to prove that the
same product flows still work after large structural changes.

## Start And Stop

- Install dependencies:
  - `npm install`
  - or package-level installs if workspaces are unavailable.
- Start backend and frontend:
  - `./start.sh`
- Open:
  - Frontend: `http://localhost:4000/templates`
  - Backend renderer: `http://localhost:4001/renderer.html`
- Stop:
  - `./stop.sh`

## Templates

- Open `Templates`.
- Create a new template.
- Open the created template in the editor.
- Duplicate an existing template.
- Delete a template.
- Import a template JSON file if one is available.

## Editor

- Add a text layer.
- Add a rectangle layer.
- Add an image layer through upload.
- Add a video layer through upload.
- Add a clock layer.
- Select, drag and resize layers.
- Change layer properties in the properties panel.
- Reorder layers.
- Create a variable.
- Bind a variable to a layer property.
- Save the template.
- Reload the template and confirm the saved state is preserved.

## Timeline

- Add a keyframe for a layer transform.
- Move the timeline playhead.
- Add or edit a director if the UI exposes it.
- Add or edit a timeline action if the UI exposes it.
- Preview playback and confirm visible animation changes.

## Settings And Channels

- Open `Settings`.
- Create a channel.
- Edit channel name and output settings.
- Set a channel to browser-only/no SDI if needed.
- Confirm the renderer URL shown in UI matches the selected channel.

## Control Panel

- Open `Control Panel`.
- Select a template.
- Change variable values.
- Select a channel.
- Press `TAKE`.
- Confirm the template appears in the browser renderer.
- Change variables and press/update live values.
- Press `CLEAR`.
- Confirm the template disappears from the browser renderer.

## Rundowns

- Create a rundown.
- Add template slots to the rundown.
- Reorder slots.
- Save or auto-save the rundown.
- Use `NEXT`/`PREV` if available.
- Take a rundown slot on air.
- Clear a rundown slot or clear all.
- Reload the page and confirm the rundown remains available.

## Browser Renderer

- Open `http://localhost:4001/renderer.html?channel=<channelId>` or the current
  renderer URL shown by the UI.
- Confirm WS connection after backend start.
- Confirm late renderer connection receives current on-air state.
- Confirm transparent background behavior is preserved.

## DeckLink Best-Effort Check

Physical DeckLink/SDI verification is not required during the foundation refactor.
Still verify:

- `decklink-out` dependencies install.
- `start-decklink.sh` resolves channels or reports a clear missing-backend message.
- No obvious syntax/runtime error was introduced in `decklink-out/src/main.js`.
- Native addon build remains documented via `./build-decklink.sh`.

## Pass Criteria

The foundation refactor can be merged into `MVP` only when:

- backend and frontend start successfully;
- the manual flows above pass, except physical DeckLink output;
- frontend build/typecheck pass;
- backend typecheck/build pass;
- GitHub Actions basic checks are green;
- any intentional behavior changes are explicitly documented in the PR.
