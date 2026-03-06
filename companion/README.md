# Companion API (SaaS)

HTTP + **WebSocket** API for **Bitfocus Companion**. Uses the **same connection code** as the playout output. No local install: deploy to **Railway**; the main app is on **Netlify**; **Supabase** does Realtime.

- **Netlify** – hosts the controller + playout (React app).
- **Railway** – hosts this Companion API (HTTP + WebSocket).
- **Supabase** – Realtime (controller ↔ playout, controller ↔ this API).

Flow: **Companion → Railway (HTTP or WebSocket) → Supabase Realtime → Controller (browser)**.

**Cue list / state – Supabase table (recommended):**

The **controller** writes state to a Supabase table **`companion_state`** whenever state changes. The **Railway API** reads from that table when the Companion module calls `GET /state`. So Railway and Companion see cues even when the browser never POSTs to Railway (e.g. when `VITE_COMPANION_API_URL` is not set).

- **You must run the migration** that creates `companion_state`. From the repo root:  
  `npx supabase db push`  
  or in Supabase Dashboard → SQL Editor, run the contents of **`supabase/migrations/006_companion_state.sql`**.
- The controller (webapp) and Railway use the **same** Supabase project; anon key can read/write the table.

**Optional:** If you also set **`VITE_COMPANION_API_URL`** in the webapp, the controller will POST state to Railway as well; the API still falls back to the table when in-memory state is empty.

---

## Deploy to Railway (no local install)

**Step-by-step (GitHub → Railway, push to main = auto-update):** see **[DEPLOY_RAILWAY.md](./DEPLOY_RAILWAY.md)** for the full walkthrough.

Summary of options:

**A) GitHub (recommended)** – Connect your repo; set Root Directory to `companion`. Push to main → Railway auto-deploys. Full steps in [DEPLOY_RAILWAY.md](./DEPLOY_RAILWAY.md).

**B) Railway CLI**  
See [Railway CLI setup](#railway-cli-setup) below for a full walkthrough.

**C) Separate repo**  
Copy the `companion` folder into its own repo and connect that repo to Railway (no root directory needed).

Set **SUPABASE_URL** and **SUPABASE_ANON_KEY** in the Railway project (Variables in the dashboard). No `.env` file is used on Railway. The `.env.example` in `companion` is only for local dev or as a reminder of which variable names to use in Railway.

---

## HTTP API (Companion HTTP Request buttons)

Base URL: your Railway URL (e.g. `https://your-app.railway.app`).

| Method | Path | Query / Body | Description |
|--------|------|----------------|-------------|
| **POST** | `/state` | `?code=AB12XY`, body: JSON state | **Controller** pushes state (cues, liveIndex, etc.). Use this when `VITE_COMPANION_API_URL` is set so cues work without Realtime. |
| GET | `/state` | `?code=AB12XY` | Current state (liveIndex, nextIndex, isLive, playoutConnected, cues). |
| GET | `/cues` | `?code=AB12XY` | Cue list (index, id, name, displayName, captionTitle). |
| GET | `/take` | `?code=AB12XY` | Take preview to program. |
| GET | `/next` | `?code=AB12XY` | Select next as NEXT. |
| GET | `/prev` | `?code=AB12XY` | Select previous as NEXT. |
| GET | `/cue/:index` | `?code=AB12XY` | Go to cue by index (0-based). |
| GET | `/clear` | `?code=AB12XY` | Clear program (cut to black). |
| GET | `/fade` | `?code=AB12XY&to=black` or `to=transparent` | Fade program out. |
| GET | `/health` | — | Health check. |

Use the **same 6-character code** that appears in the controller and that the playout window uses.

**Testing in Companion (presets, buttons):** see **[COMPANION_SETUP.md](./COMPANION_SETUP.md)** for step-by-step setup using Companion’s HTTP Request connection and copy-paste preset URLs (Take, Next, Prev, Cue 0–N, Clear, Fade). There is no custom Companion module in this repo; you use the built-in HTTP connection.

---

## WebSocket API (live state, no polling)

Connect to your Railway URL with **WSS** (e.g. `wss://your-app.railway.app`). Same port as HTTP; the server handles the WebSocket upgrade.

1. **Register** with your connection code:
   ```json
   { "type": "register", "code": "AB12XY" }
   ```
   Server responds: `{ "type": "registered", "code": "AB12XY" }` and immediately sends current state: `{ "type": "state", "payload": { ... } }`.

2. **Receive state** – server pushes state whenever the controller updates:
   ```json
   { "type": "state", "payload": { "liveIndex": 0, "nextIndex": 1, "isLive": true, "playoutConnected": true, "cues": [...] } }
   ```

3. **Send commands** (same as HTTP trigger):
   - `{ "type": "take" }`
   - `{ "type": "next" }`
   - `{ "type": "prev" }`
   - `{ "type": "cue", "cueIndex": 2 }`
   - `{ "type": "clear" }`
   - `{ "type": "fade", "fadeTo": "black" }` or `"transparent"`

   Server responds with `{ "ok": true, "action": "take" }` etc.

Companion modules that support WebSocket can use this for real-time feedback without polling.

---

## Alternative: Netlify Functions + Supabase table (no Railway)

If you prefer to keep everything on **Netlify** (no Railway):

- **Trigger (take, next, clear, etc.):** Add **Netlify Functions** that receive HTTP (e.g. `/.netlify/functions/companion-take?code=AB12XY`) and use the Supabase client to **broadcast** the command on the Realtime channel. The controller (browser) is already subscribed and runs the action. No extra service.
- **Fetch (state, cues):** Netlify Functions are short-lived, so they can’t hold a Realtime subscription. You’d add a **Supabase table** (e.g. `companion_state`: `connection_code` primary key, `state` JSONB, `updated_at`). The **controller** writes to this table whenever state changes (same payload it currently broadcasts). A Netlify Function then **reads** that table for `GET /state?code=...` and `GET /cues?code=...` and returns JSON. Companion would **poll** these endpoints (no WebSocket).

Tradeoffs: one less service (no Railway), but you need a migration for the table, controller logic to write state to the table, and no live WebSocket—Companion polls for feedback. The Railway option gives you WebSocket and no table.

---

## Railway CLI setup

Use this to deploy the `companion` folder to Railway from your machine (no GitHub required).

### 1. Install Railway CLI

**Windows (PowerShell):**  
```powershell
irm https://railway.app/install.ps1 | iex
```
Or with npm: `npm install -g @railway/cli`

**macOS / Linux:**  
```bash
curl -fsSL https://railway.app/install.sh | sh
```
Or with npm: `npm install -g @railway/cli`

Check it works: `railway --version`

### 2. Log in

```bash
railway login
```
A browser window opens; sign in or create a Railway account.

### 3. Open the companion folder and create a project

From your repo root:

```bash
cd companion
railway init
```

- Choose **Create a new project** (or link to an existing one).
- Give the project a name if prompted (e.g. `frameflow-companion`).
- Railway creates a project and links this folder to it.

### 4. Set environment variables

In the [Railway dashboard](https://railway.app/dashboard): open your project → your service → **Variables** tab. Add:

| Variable            | Value                          |
|---------------------|---------------------------------|
| `SUPABASE_URL`      | Your Supabase project URL       |
| `SUPABASE_ANON_KEY`| Your Supabase anon key          |

(Same values as your main app / `.env`.)

Or from the CLI (from the `companion` folder):

```bash
railway variables set SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_ANON_KEY=your-anon-key
```

### 5. Deploy

From the `companion` folder:

```bash
railway up
```

Railway builds the app (using the Dockerfile) and deploys. When it’s done, open the project in the dashboard and go to **Settings** → **Networking** → **Generate Domain** to get a public URL (e.g. `https://companion-production-xxxx.up.railway.app`).

### 6. Use the URL in Companion

- **HTTP:** `https://your-app.up.railway.app/take?code=AB12XY`, `/state?code=AB12XY`, etc.
- **WebSocket:** `wss://your-app.up.railway.app` (then send `{ "type": "register", "code": "AB12XY" }`).

Later, to deploy again after changes: `cd companion` then `railway up`.

---

## Local run (optional)

For development only; production uses Railway (or Netlify Functions as above).

```bash
cd companion
npm install
npm start
```

Create a `.env` in `companion` with `SUPABASE_URL` and `SUPABASE_ANON_KEY`, or use `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the repo root `.env`. Listens on port 3333 (or `PORT`).
