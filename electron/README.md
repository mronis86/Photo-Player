# Frameflow Local App

Two modes:

## 1. Playout-only (Netlify front end)

Use the **controller on the web** (Netlify). The portable app just **opens a playout browser** so you can connect.

- Set `FRAMEFLOW_APP_URL` to your Netlify app URL (e.g. `https://your-app.netlify.app`).
- Run the app: `FRAMEFLOW_APP_URL=https://your-app.netlify.app npm run electron` (or set the env in a shortcut).
- Click **"Open playout (browser)"** — your browser opens the playout page (on Netlify).
- Use the **controller** in another tab at your Netlify URL; connect playout with the connection code (Realtime).

No local server. Controller = web (Netlify); playout = same web app, opened by this launcher.

**Quick way (no Electron):** Use **"Open Playout (Web).bat"** — edit the URL inside, then double-click. It opens the playout URL in your default browser.

## 2. Local server (full stack, local files)

When `FRAMEFLOW_APP_URL` is **not** set, the app runs the Node server and opens controller/playout at localhost.

- **Same computer:** Run the app → "Open controller" / "Open playout" → use at localhost. Local files work.
- **Same network:** Launcher shows "Same network" URL; open it on another device for controller or playout.

## Run (development)

1. Build the web app once: `npm run build`
2. Start the local app: `npm run electron`

Or in one step: `npm run app` (builds then starts Electron).

## Package (portable / installer)

1. `npm run build`
2. `npm run dist:app` — output in `release/` (unpacked directory; use for testing or zip for portable).
3. For installers, add a proper `electron-builder` target (e.g. `win` / `portable` / `nsis`) in `package.json` "build" and run `electron-builder`.

## Requirements

- `dist/` must exist (run `npm run build` first). The server serves the built frontend when `NODE_ENV=production`.
- Optional: set `HUGGING_FACE_TOKEN` in `.env` (or system env) for image analysis in the local app.
