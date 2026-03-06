# Companion + Webapp Logging

Use these logs to confirm the controller, Railway API, and Companion module are talking and why cues might not appear.

---

## 1. Webapp (Controller)

**Where:** Browser DevTools → **Console** (F12 or right‑click → Inspect → Console).

**Filter:** Type `Companion` in the console filter so you only see these lines.

**What you’ll see:**

- **`[Companion] Channel joined, code: XXXXXX`** – Controller joined the Realtime channel for that code. You should see this when the page loads and a connection code is set.
- **`[Companion] State sent, cues: N liveIndex: X nextIndex: Y`** – Controller is broadcasting state. **N** = number of cues in the project. If you have a project with cues open, N should be &gt; 0.
- **`[Companion] Sent state (requested by API), cues: N`** – API asked for state and the controller replied. Again, N should match your cue count.
- **`[Companion] Command received: next`** (or take, prev, cue 2, clear, fade black) – A command from Companion (via the API) was received. If you press Next in Companion and this appears, the webapp is receiving and will move preview to the next cue.

**Sync:** When you press **Next** in Companion, you should see `[Companion] Command received: next` and the **preview** in the webapp should move to the next cue. Same for **Prev**, **Take**, **Clear**, **Cue N**, etc. The webpage and Companion are in sync when these commands show up and the UI updates.

---

## 2. Railway (Companion API)

**Where:** Railway project → your service → **Deployments** → select the latest deployment → **View Logs** (or **Logs** tab).

**What you’ll see:**

- **`[Companion API] new channel code=XXXXXX`** – First request for that code created the channel.
- **`[Companion API] subscribed code=XXXXXX, requesting state`** – API subscribed to Realtime and sent “request state” to the controller.
- **`[Companion API] state received code=XXXXXX cues=N liveIndex=X`** – API received a state broadcast from the controller. **cues=N** is the number of cues. If this never appears or always shows `cues=0`, the controller is not sending state or the code doesn’t match.
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

1. **Webapp:** Same **connection code** as in Companion, **project open with cues**, and in the console you see **`State sent, cues: N`** with **N &gt; 0**.
2. **Railway:** In logs you see **`state received code=... cues=N`** with **N &gt; 0** for that code. If you never see this, the controller broadcast isn’t reaching the API (check code match and Supabase).
3. **Companion:** In the module log you see **`State fetched ... cues=N`** with **N &gt; 0**. If you see **cues=0**, the API either has no state yet or returned empty; wait a few seconds and check Railway logs for **state received**.
4. **Supabase:** Railway must use the **same** Supabase project as the webapp. In Railway → Variables, set **SUPABASE_URL** and **SUPABASE_ANON_KEY** to the same values as in your app (e.g. from `.env`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`). If they differ, the API and controller are on different Realtime and state never reaches the API.

---

## Sync (webpage ↔ Companion)

- **Companion → Webpage:** Press Next/Prev/Take/Cue in Companion → Railway log shows **command ... next** (etc.) → Webapp console shows **`[Companion] Command received: next`** → Preview or program updates. If the command appears in the webapp but nothing moves, the refs/handlers may be wrong; if the command never appears, the API or Realtime may not be reaching the controller.
- **Webpage → Companion:** Change something in the controller (e.g. select another cue) → Controller sends state → Railway shows **state received** → Next time the module polls it gets new state and presets/feedback update.
