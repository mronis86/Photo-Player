# Companion sync test checklist

Use this to confirm: **page → Railway** (state) and **Companion → Railway → Supabase → page** (commands) so everything stays in sync.

---

## Before you start

- **Supabase tables for cues (required):** The controller writes state to **`companion_state`**; Railway reads from it. You must run **both** migrations so writes work when you’re signed in:
  - **006_companion_state.sql** – creates the table and anon policies (for Railway).
  - **008_companion_state_authenticated_rls.sql** – allows **authenticated** users (signed-in controller) to insert/update. Without this, the table stays empty and you get 0 cues.
  - From the repo root: **`npx supabase db push`**  
  - Or in **Supabase Dashboard → SQL Editor**, run the contents of each migration file in order.
- (Optional) **.env** can have `VITE_COMPANION_API_URL=https://your-app.up.railway.app`. If set and dev server was restarted, the controller also POSTs to Railway; the table is still used so cues work either way.
- **Railway** service is deployed and running. In Railway → Variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY` match your webapp (same Supabase project).
- **Companion** module is installed and configured with the **same** Railway URL and a **6-character connection code** you’ll use in the controller.

---

## Test 1: Page → Railway (state)

1. Start the webapp locally: `npm run dev` (or open your deployed controller).
2. Open the **controller** page, enter the **same 6-character code** you use in Companion.
3. Open a **project that has at least one cue** (so the cue list isn’t empty).
4. Open **browser DevTools → Console**. Filter by `Companion`.
5. You should see (once) **`[Companion] Using Railway HTTP: https://...`** – if you see **`Using Realtime only`** instead, the env var wasn’t loaded; restart the dev server and try again.
6. You should see:
   - **`[Companion] State sent (HTTP), cues: N liveIndex: ... nextIndex: ...`** with **N ≥ 1** when you load the project or change something (take, next, etc.).  
   If you see **`State sent (Realtime)`** instead, `VITE_COMPANION_API_URL` is not set or the dev server wasn’t restarted after adding it.

If you see **State sent (HTTP)** and **Using Railway HTTP**, the **page is sending state to Railway** over HTTP.

7. In **Railway** → your service → **Logs**, you should see lines like:
   - **`[Companion API] POST /state code=XXXXXX cues=N liveIndex=...`** (XXXXXX = your code, N = cue count).

If you see that, **Railway is receiving state** from the page.

---

## Test 2: Railway → Companion (cues in module)

1. With the controller still open (same code, project with cues), wait a few seconds.
2. In **Companion**, open the **FotoFlow / Image Motion Playback** module and ensure the **connection code** matches.
3. In the module’s **Presets**, open the **Cues** category.
4. You should see **one preset per cue** (e.g. “1: filename”, “2: filename”), not only “No cues”.

If you see cue presets, **Companion is getting state from Railway** (GET /state) and staying in sync with the project.

5. In **Companion’s log** (Settings / Show Log for the module) you should see something like:
   - **`State fetched code=XXXXXX cues=N`** with **N ≥ 1**.

---

## Test 3: Companion → Railway → Supabase → Page (commands)

1. Keep the controller open in the browser (same code, project with cues). Keep the console open.
2. In **Companion**, press a button that triggers an action, e.g. **Next** or **Take**.
3. **Railway logs** should show:
   - **`[Companion API] command code=XXXXXX next`** (or `take`, `prev`, etc.).
4. **Browser console** should show:
   - **`[Companion] Command received: next`** (or take, prev, etc.).
5. **Controller UI** should update: e.g. preview moves to next cue, or take goes to program.

If all of that happens, **Companion → Railway (HTTP) → Supabase (broadcast) → page** is working and everything stays in sync.

---

## Quick reference

| Direction              | How it works                                      | What to check                          |
|-----------------------|---------------------------------------------------|----------------------------------------|
| Page → Railway         | Controller POSTs state (HTTP) when state changes | Console: `State sent (HTTP)`; Railway: `POST /state` |
| Railway → Companion    | Module polls GET /state                           | Cue presets show; module log: `State fetched ... cues=N` |
| Companion → Railway    | Module calls /take, /next, etc. (HTTP)            | Railway log: `command code=... next`   |
| Railway → Page         | API broadcasts command via Supabase Realtime      | Console: `Command received: next`; UI updates |

---

## If something doesn’t match

- **No “State sent (HTTP)”** → Check `VITE_COMPANION_API_URL` in `.env`, restart dev server. Check browser Network tab for POST to `/state` (might be CORS or wrong URL).
- **Railway never shows POST /state** → Same code in controller and in Companion? Controller has a project with cues open?
- **Companion shows “No cues”** → Module’s API URL = Railway URL, code matches. Wait a few seconds after opening the project. Check Railway logs for `POST /state ... cues=N` with N > 0.
- **Command in Companion but nothing in console / UI** → Railway needs correct `SUPABASE_URL` and `SUPABASE_ANON_KEY` (same as webapp). Check Railway log for `command code=...` then check Supabase project matches.
