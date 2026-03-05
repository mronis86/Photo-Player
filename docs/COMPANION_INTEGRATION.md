# Bitfocus Companion Integration (Image Motion Playback)

Companion integrates using the **same connection code** as the playout output. One code gives access to: trigger actions, fetch project/cue list, and get live feedback for presets (active cue, file names, etc.).

---

## SaaS stack (no local install)

- **Netlify** – hosts the main app (controller + playout). Users open the app in the browser.
- **Railway** – hosts the **Companion API** (see `companion/` in the repo). HTTP + **WebSocket**; same connection code as playout. Users do **not** install anything; Companion talks to the Railway URL.
- **Supabase** – Realtime (controller ↔ playout, controller ↔ Companion API).

Flow: **Companion → Railway (HTTP or WebSocket) → Supabase Realtime → Controller**. Deploy the `companion` folder to Railway and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Companion uses the Railway base URL (e.g. `https://your-app.railway.app`) for both HTTP (e.g. `/take?code=AB12XY`) and WebSocket (connect to `wss://your-app.railway.app`, then send `{ "type": "register", "code": "AB12XY" }` for live state). See `companion/README.md` for full API and deploy steps.

---

## 1. Same code as output

- **Playout** already uses a 6-character connection code (e.g. `AB12XY`). The controller and playout join the same Supabase Realtime channel `playout:CODE`.
- **Companion** should use that **same code** so one “session” = one code:
  - Same code in the playout window and in Companion.
  - Companion (or an API that Companion calls) uses the code to **subscribe to the same session** and to **send commands** the controller will act on.

So: **one code = output + Companion** for that controller instance.

---

## 2. What we need to implement (method)

### A. Realtime channel keyed by code

- **Existing:** `playout:CODE` — used for playout (connect, heartbeat, play, stop, fade, etc.).
- **Add:** Use the same channel (or a dedicated **companion** event on it) for:
  - **Commands to controller:** `take`, `next`, `prev`, `cue/:index`, `clear`, `fade` (Companion or API sends; controller subscribes and runs the same logic as the on-screen buttons).
  - **State from controller:** Controller **publishes** a state payload whenever something changes (live cue index, next cue index, is_live, playout_connected, **cue list summary**).

So the **method** is: one Realtime channel per code; controller both **listens for companion commands** and **broadcasts state** on that channel.

### B. HTTP API for Companion (recommended)

Companion works best with **HTTP**. So add a small **Companion API** that uses the code for everything:

| Purpose | Method | Example |
|--------|--------|--------|
| **Trigger** | GET/POST with `?code=AB12XY` (or header) | `GET /api/companion/take?code=AB12XY` |
| **Fetch state** | GET with code | `GET /api/companion/state?code=AB12XY` → `{ liveIndex, nextIndex, isLive, playoutConnected, cues: [...] }` |
| **Fetch cue list / file names** | GET with code | `GET /api/companion/cues?code=AB12XY` → `[{ index, id, name, captionTitle, ... }, ...]` |

**How the API gets state and cue list:**

- **Option 1 (Realtime only):**  
  - API (or a long-lived service) **subscribes** to `playout:CODE` (or a dedicated `companion:CODE` channel).  
  - Controller **broadcasts state** (and optionally cue list) on that channel whenever state changes.  
  - API **caches** the latest state in memory.  
  - `GET /api/companion/state` and `GET /api/companion/cues` **return from cache** (no DB needed).  
  - For **trigger** actions, API receives HTTP from Companion, then **sends a message** on the same Realtime channel; controller receives it and runs take/next/cue/clear.

- **Option 2 (Supabase table):**  
  - Controller **writes** state (and optionally cue list snapshot) to a Supabase table row keyed by `connection_code` (e.g. `companion_state` table).  
  - API **reads** that table for `GET /api/companion/state` and `GET /api/companion/cues`.  
  - For **trigger**, API still sends a command via Realtime so the controller reacts immediately; table is for “fetch” and for any other consumer.

**Recommended:** Option 1 (Realtime + in-memory cache in API) keeps everything in one place (same code, same channel) and avoids extra tables. Option 2 is useful if you want state to survive API restarts or to be queried by other tools.

### C. Controller changes

1. **Subscribe to companion commands** (same channel `playout:CODE` or a dedicated `companion:CODE`):
   - On message types `take`, `next`, `prev`, `cue`, `clear`, `fade` → run the same handlers as the TAKE / NEXT / PREV / CLEAR / FADE buttons.
2. **Publish state** on that channel whenever:
   - Live or next cue changes, is_live changes, playout connect/disconnect, or cue list changes (add/remove/reorder).
   - Payload example: `{ liveIndex, nextIndex, isLive, playoutConnected, cues: [{ index, id, name, captionTitle, displayName }, ...] }` so Companion (or the API cache) can expose “current cue”, “next cue”, and “list of file names” for presets.

### D. Companion presets

- **Buttons** call the HTTP API with the same code (e.g. stored in a variable per instance):
  - TAKE, Next, Prev, Cue 1..N, Clear, Fade.
- **Feedback** (what’s active, file names, etc.):
  - **Polling:** Companion polls `GET /api/companion/state` and `GET /api/companion/cues` every 1–2 s and sets button text/color from the response (e.g. “Live” on current cue, show cue names).
  - **Or** a Companion module that subscribes to Supabase Realtime and updates button state in real time (no polling).

With that in place you can build **presets** that:
- Show which cue is live / next.
- List cue names (file names / display names) and let you trigger by index or ID.
- Reflect playout connected state.
- Optionally drive dynamic buttons (one per cue) with names from `GET /api/companion/cues`.

---

## 3. Summary: method to implement

| Step | What to do |
|------|------------|
| 1 | **Realtime:** Controller subscribes to companion commands on the channel for the connection code (same code as output). On `take` / `next` / `prev` / `cue` / `clear` / `fade` → run existing button logic. |
| 2 | **Realtime:** Controller publishes **state** (liveIndex, nextIndex, isLive, playoutConnected, cues) on the same channel whenever it changes. |
| 3 | **API:** Add HTTP endpoints that take `code` (query or header): `GET /state`, `GET /cues`, and trigger endpoints `GET /take`, `GET /next`, `GET /prev`, `GET /cue/:index`, `GET /clear`, `GET /fade`. |
| 4 | **API:** For **fetch** (state/cues), API subscribes to the Realtime channel for that code and caches latest state; GETs return from cache. For **trigger**, API sends the corresponding message on Realtime so the controller reacts. |
| 5 | **Companion:** Presets use the same code; buttons call the API; feedback comes from polling `GET /state` and `GET /cues` (or from a Realtime-aware module). |

That gives you **one code for output and Companion**, fetch of project/cue list and file names, and presets with feedback for what’s active and options to trigger by cue name/index.

---

## 4. When hosted on Netlify: direct to Supabase or something in between?

Once the app is on **Netlify**, the **controller and playout** (browser) already talk **directly to Supabase** (Realtime, Auth, etc.). No change there.

For **Companion** (fetch + trigger), you have two options:

### Option A: Companion → Netlify (serverless) → Supabase

- **Companion** sends HTTP to your **Netlify Functions** (e.g. `https://your-app.netlify.app/.netlify/functions/companion-take?code=AB12XY`).
- Each **Netlify Function** receives the request, then uses the **Supabase JS client** to **trigger** by sending a broadcast on the Realtime channel for that code; the controller (browser) is already subscribed and runs the action.
- For **fetch** (state/cues), serverless functions exit after each request, so you typically have the controller **write state to a Supabase table** (e.g. `companion_state` keyed by code), and the function **reads that table** and returns JSON to Companion.
- **Pros:** One place to validate the code, rate-limit, or add API keys; no Supabase credentials on the machine running Companion.
- **Cons:** You implement and host the functions; for fetch you need a table (or a separate long-lived service that caches Realtime and exposes HTTP).

### Option B: Companion talks direct to Supabase

- A **Companion custom module** or **small bridge app** (on the machine running Companion) uses the **Supabase JS client** with your **anon key** (same as the frontend).
- It **subscribes** to the Realtime channel for the connection code and receives **state** (and cue list) that the controller broadcasts. Fetch = subscribe and cache locally; no Netlify in the middle.
- It **sends** trigger commands by **broadcasting** on the same channel; the controller (browser) receives them and runs take/next/cue/clear.
- **Pros:** No serverless to maintain; same Realtime channel as the rest of the app; works as soon as the controller broadcasts state.
- **Cons:** The anon key lives in the Companion module/bridge (same as in the browser; Realtime is scoped by channel/code).

**Summary:** **Direct to Supabase** = Companion (via module or bridge) subscribes and broadcasts on the same Realtime channel; no Netlify. **Via something else (Netlify)** = Companion calls Netlify Functions; functions call Supabase (Realtime for trigger; table or cache for fetch). Use Netlify if you want all Companion traffic through your own API.
