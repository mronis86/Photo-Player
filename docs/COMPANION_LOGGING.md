# Companion + Webapp Logging

Use these logs to confirm the controller, Railway API, and Companion module are talking and why cues might not appear.

---

## Recommended: HTTP state (no Realtime for state)

**Best way to keep cues working consistently:** use **Railway for state** and only use Supabase for **commands** (API → controller).

1. **Webapp** – In your app `.env` (or Netlify env), set **`VITE_COMPANION_API_URL`** to your Railway API URL, e.g. `https://your-app.up.railway.app` (no trailing slash).
2. **Controller** – When that env is set, the controller **POSTs** state to `POST /state?code=XXX` on every change (and a 10s heartbeat). No Supabase Realtime is used for state.
3. **Railway API** – Accepts `POST /state`, stores state in memory, and serves it on `GET /state`. The Companion module keeps polling `GET /state` as before.
4. **Commands** – Still go Module → Railway (HTTP) → API broadcasts via **Supabase Realtime** → Controller. So Supabase is only needed for pushing commands to the browser.

You should then see **`[Companion] State sent (HTTP), cues: N`** in the browser and **`[Companion API] POST /state code=XXX cues=N`** in Railway logs. Cues should appear in the module without depending on Realtime for state.

---

## 1. Webapp (Controller)

**Where:** Browser DevTools → **Console** (F12 or right‑click → Inspect → Console).

**Filter:** Type `Companion` in the console filter so you only see these lines.

**What you’ll see:**

- **`[Companion] Channel joining, code: XXXXXX`** – Controller is joining the Realtime channel for that code.
- **`[Companion] Channel SUBSCRIBED (WebSocket), sent state, cues: N`** – Channel is ready over WebSocket; first state was sent. If you see “Realtime send() is automatically falling back to REST API” elsewhere, the first send may have happened before SUBSCRIBED; the controller now defers the first send so Realtime uses WebSocket.
- **`[Companion] State sent (HTTP), cues: N liveIndex: X nextIndex: Y`** – State was sent to the **Railway API** over HTTP (when `VITE_COMPANION_API_URL` is set). Cues and feedback stay in sync without Realtime.
- **`[Companion] State sent (Realtime), cues: N liveIndex: X nextIndex: Y`** – State was sent over Supabase Realtime (when `VITE_COMPANION_API_URL` is not set). State is sent only when something changed, not constantly.
- **`[Companion] Sent state (requested by API), cues: N`** – API asked for state and the controller replied. Again, N should match your cue count.
- **`[Companion] Command received: next`** (or take, prev, cue 2, clear, fade black) – A command from Companion (via the API) was received. If you press Next in Companion and this appears, the webapp is receiving and will move preview to the next cue.

**Sync:** When you press **Next** in Companion, you should see `[Companion] Command received: next` and the **preview** in the webapp should move to the next cue. Same for **Prev**, **Take**, **Clear**, **Cue N**, etc. The webpage and Companion are in sync when these commands show up and the UI updates.

---

## 2. Railway (Companion API)

**Where:** Railway project → your service → **Deployments** → select the latest deployment → **View Logs** (or **Logs** tab).

**What you’ll see:**

- **`[Companion API] new channel code=XXXXXX`** – First request for that code created the channel.
- **`[Companion API] subscribed code=XXXXXX, requesting state`** – API subscribed to Realtime and sent “request state” to the controller.
- **`[Companion API] POST /state code=XXXXXX cues=N liveIndex=X`** – Controller sent state over **HTTP**. This is the preferred path when `VITE_COMPANION_API_URL` is set.
- **`[Companion API] state received (Realtime) code=XXXXXX cues=N liveIndex=X`** – API received state from Supabase Realtime (when webapp doesn’t use HTTP POST).
- **`[Companion API] GET /state code=XXXXXX hasState=true cues=N`** – The Companion module polled `/state`. **hasState=true** and **cues=N** mean the module will get the cue list. If **hasState=false** or **cues=0**, the module will show “No cues”.
- **`[Companion API] command code=XXXXXX next`** (or take, prev, etc.) – The module triggered an action; the API is sending that command to the controller.

---

## 3. Companion (FotoFlow module)

**Where:** In Companion → **Settings** / **Show Log** (or the log window for your instance). Exact location depends on your Companion version; often a **Log** tab or **View Log** for the connection.

**What you’ll see:**

- **`Init code=XXXXXX apiUrl=...`** – Module started with that code and API URL.
- **`State fetched code=XXXXXX cues=N hasState=true`** – Module got a response from `/state`. **cues=N** is how many cue presets will be built. If **cues=0** or **hasState=false**, you’ll only see the “No cues” placeholder.
- **`Presets updated: Transport + Cues(N)`** – Presets were rebuilt. **N** = number of cue buttons. Should be &gt; 0 when the API is returning cues.
- **`Take`** / **`Next`** / **`Prev`** / **`Go to cue N`** / **`Clear`** – One of these when you press a button; the module called the API.

---

## Quick checklist (cues not showing)

1. **Use HTTP for state (recommended):** In the webapp `.env` (or Netlify env), set **`VITE_COMPANION_API_URL`** to your Railway URL (e.g. `https://your-app.up.railway.app`). Restart or rebuild the app. You should see **`[Companion] State sent (HTTP), cues: N`** and Railway logs **`POST /state code=... cues=N`**.
2. **Webapp:** Same **connection code** as in Companion, **project open with cues**, and in the console **`State sent (HTTP)`** or **`State sent (Realtime)`** with **N &gt; 0**.
3. **Railway:** In logs you see **`POST /state code=... cues=N`** (HTTP) or **`state received (Realtime) code=... cues=N`**. If you never see either, the controller isn’t reaching the API (check `VITE_COMPANION_API_URL` and code match).
4. **Companion:** In the module log you see **`State fetched ... cues=N`** with **N &gt; 0**. If **cues=0**, the API has no state yet; ensure the controller has opened a project with cues and sent state (HTTP or Realtime).
5. **Commands (Supabase):** For Take/Next/Prev to reach the webapp, Railway still needs **SUPABASE_URL** and **SUPABASE_ANON_KEY** (same as webapp) so the API can broadcast commands. State can be HTTP-only; commands still use Realtime.

---

## Why the API isn’t flooded when a cue is “Take” (live)

State is sent **only when something changes**: live index, next index, cue list, or connection flags. While a cue is simply sitting in “Take” (program), those values don’t change, so the controller does **not** keep sending. You’ll see **`State sent (change)`** when you take a cue, move next/prev, or load a different project; you won’t see repeated sends just because a cue is live.

A slow **heartbeat** (every 10 seconds) still runs so the API can recover state if it missed an update (e.g. after a reconnect).

---

## WebSocket vs REST fallback

If the browser console shows **“Realtime send() is automatically falling back to REST API”**, Supabase is sending over HTTP instead of the WebSocket. The controller is set up to reduce that:

- The send function is only set when the channel is **SUBSCRIBED** (WebSocket ready).
- The first state send after subscribe is deferred with `setTimeout(..., 0)` so it runs on the next event loop tick, when the WebSocket is the active transport.

If you still see the REST fallback, try a hard refresh or check that you’re not sending from anywhere before the channel is subscribed. All sends go through the ref that is set in `onSubscribed`.

---

## Sync (webpage ↔ Companion)

- **Companion → Webpage:** Press Next/Prev/Take/Cue in Companion → Railway log shows **command ... next** (etc.) → Webapp console shows **`[Companion] Command received: next`** → Preview or program updates. If the command appears in the webapp but nothing moves, the refs/handlers may be wrong; if the command never appears, the API or Realtime may not be reaching the controller.
- **Webpage → Companion:** Change something in the controller (e.g. select another cue) → Controller sends state (HTTP POST or Realtime) → Railway shows **POST /state** or **state received** → Next time the module polls it gets new state and presets/feedback update.

---

## Reference project (Railway + Neon, etc.)

If you have another project where Railway + Neon (or similar) is already working and synced (read/fetch, send back and forth), sharing that repo or key files can help align this one. Useful things to compare: env vars (Railway Variables vs app `.env`), how the app talks to the API (fetch URLs, CORS), and how often state is sent. The HTTP state flow above (POST from webapp to Railway, GET from module) is designed to match a simple “Railway as central API” pattern so cues stay consistent.
