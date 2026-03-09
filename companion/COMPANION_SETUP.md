# Testing in Bitfocus Companion (no custom module)

There is **no custom Companion module** in this repo. You test by adding Companion’s built-in **HTTP Request** (or **Generic HTTP**) connection and creating buttons that call the Railway API. Use the **same 6-character connection code** as in the controller and playout.

---

## Railway: Companion service only

When the app is hosted on **Netlify**, Railway only needs the **Companion service** (this `companion/` app). Deploy `companion/index.js` as a single Railway service — do **not** deploy the main API server (`server/index.js`) on Railway for this setup. The Netlify app uses Supabase directly for projects and companion state; Companion transport buttons call this Railway service.

---

## 1. Get your URLs and code

- **Base URL:** Your Railway Companion API (e.g. `https://your-service.up.railway.app`). No trailing slash.
- **Connection code:** The 6-character code shown in the controller (e.g. `AB12XY`). Same code the playout window uses.

---

## 2. Add the connection in Companion

1. In Companion, go to **Connections** (or **Add connection**).
2. Add **HTTP Request** or **Generic HTTP** (name depends on your Companion version).
3. Set **Base URL** to your Railway URL, e.g. `https://your-service.up.railway.app`.
4. Save. You’ll use this connection for all buttons below.

If your connection has a **variable** or **instance config** for a “code”, you can set it once to your connection code (e.g. `AB12XY`) and then use it in the URL (e.g. `?code=$(code)`). Otherwise, put the code in each URL.

---

## 3. Presets (button URLs)

Use these as the **URL** or **Path** for each button (with your real code). Base URL is already set in the connection.

| Button label     | Method | Path + query | Notes |
|------------------|--------|--------------|--------|
| **Take**         | GET    | `/take?code=AB12XY` | Preview → Program |
| **Next**         | GET    | `/next?code=AB12XY` | Select next cue as NEXT |
| **Prev**         | GET    | `/prev?code=AB12XY` | Select previous as NEXT |
| **Cue 0**        | GET    | `/cue/0?code=AB12XY` | Go to first cue (0-based) |
| **Cue 1**        | GET    | `/cue/1?code=AB12XY` | Go to second cue |
| **Cue 2**        | GET    | `/cue/2?code=AB12XY` | etc. |
| **Cue N**        | GET    | `/cue/N?code=AB12XY` | N = 0-based index |
| **Clear**        | GET    | `/clear?code=AB12XY` | Clear program (cut to black) |
| **Fade to black**    | GET | `/fade?code=AB12XY&to=black` | Fade out to black |
| **Fade to transparent** | GET | `/fade?code=AB12XY&to=transparent` | Fade out to transparent |

Replace `AB12XY` with your actual connection code in every URL.

---

## 4. Optional: feedback (state / cue names)

- **State:** `GET /state?code=AB12XY` returns JSON: `liveIndex`, `nextIndex`, `isLive`, `playoutConnected`, `cues`.
- **Cue list:** `GET /cues?code=AB12XY` returns the cue list (index, id, name, displayName, captionTitle).

If your HTTP connection supports **polling** and **button feedback**, you can poll one of these and map `liveIndex` / `nextIndex` to button style (e.g. “Live” on current cue). Otherwise you can still use the trigger presets above without feedback.

---

## 5. Quick test

1. Open the controller in the browser and note the connection code.
2. Open the playout window and connect with the same code (or leave it connected).
3. In Companion, add one button: **Take** → URL `https://your-railway.up.railway.app/take?code=YOUR_CODE`.
4. Press the button; the controller should take preview to program.

If that works, add the other presets from the table.

---

## Custom Companion module

A full **Companion module** (e.g. “Image Motion Playback” or “FrameFlow”) with config, presets, and feedback lives in this repo at **`companion-module/`**. It uses the same structure as typical Bitfocus modules (e.g. Run of Show).

- **Config:** API Base URL (Railway), Connection Code (6 chars), Poll interval.
- **Presets:** Transport (Take, Next, Prev, Clear, Fade) and one preset per cue (with live/next feedback).
- **Actions:** take, next, prev, go to cue, clear, fade.
- **Feedbacks:** Live cue is, Next cue is, Playout connected, Is live, Button text from cue.
- **Variables:** live_index, next_index, is_live, playout_connected, cue_count, live_cue_name, next_cue_name.

To install: from the repo root, `cd companion-module`, then `yarn install` and `yarn package`; import the built module into Companion (Developer → Import module from file). See **companion-module/README.md** for details.
