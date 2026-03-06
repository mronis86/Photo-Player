# Companion module: FotoFlow: Image Motion Playback

Bitfocus Companion module for **FotoFlow: Image Motion Playback** (same connection code as the playout window). Talks to your **Railway Companion API** (the `companion/` server in this repo).

## Config

- **API Base URL** – Your Railway API URL (e.g. `https://your-app.up.railway.app`). No trailing slash.
- **Connection Code** – 6-character code from the controller (same as playout).
- **Sync cue list** – When ON, each poll refreshes cue presets and names. When OFF, only state is fetched for **live/next/Take feedback** (no cue list churn); use with a fast **Feedback poll** for responsive buttons.
- **Poll interval** – When Sync cue list is ON: how often to fetch and refresh (5–120 s).
- **Feedback poll** – When Sync cue list is OFF: how often to fetch state for feedback only (1–60 s). Lower = more responsive Take/live/next highlights.

## Actions

- **Take** – Preview → Program
- **Next** – Select next cue as NEXT
- **Prev** – Select previous as NEXT
- **Go to cue** – Go to cue by index (dropdown from current cue list, or 0–20 if no cues)
- **Clear** – Clear program (cut to black)
- **Fade** – Fade to black or transparent

## Presets

- **Transport:** Take (grey → red when live), Next, Prev, Clear (dark grey), Fade Black (2 lines), Fade Transparent, **Output status** (shows OUTPUT CONNECTED / DISCONNECTED; green when playout connected)
- **Cues:** One preset per cue (from controller cue list) with live/next feedback; or placeholder when no cues are loaded. Cue preset **button text** (e.g. `1: filename`) is driven by the **Button text: cue name** feedback, so when you rename a cue in the webapp the button label updates on the next sync (within one poll interval).

## Feedbacks

- **Live cue is** – Highlight when the selected cue index is live (program)
- **Next cue is** – Highlight when the selected cue index is next
- **Playout connected** – Playout window is connected
- **Is live** – Program has a cue
- **Button text: cue name** – Sets button text to `N: cue name` from current state; used on cue presets so renames in the webapp auto-update the button

## Variables

- `live_index`, `next_index`, `is_live`, `playout_connected`, `cue_count`, `live_cue_name`, `next_cue_name`

## Install in Companion (3.x, e.g. 3.2.2)

### Option A: Developer folder (recommended – no build)

1. **Install dependencies** (once) in this folder:
   ```bash
   cd companion-module
   npm install
   ```
   (or `yarn` if you use Yarn.)

2. **In Companion:**
   - Open the **Companion launcher** (the window that opens when you start Companion).
   - Click the **cog (⚙)** in the top right → **Advanced Settings**.
   - Turn **Enable Developer Modules** **ON**.
   - In the **Developer** section, click **Select** and choose the **parent folder** that *contains* `companion-module` (e.g. the `PHOTO PLAYER` folder), **not** the `companion-module` folder itself.
   - Close the settings. Companion will load any module that has a `companion/manifest.json` inside a subfolder.

3. **Add the connection:** In the Companion **Connections** list (or Add connection), look for **FotoFlow: Image Motion Playback**. Add it and set **API Base URL** (Railway) and **Connection Code** (from the controller).

**If you don’t see “FotoFlow: Image Motion Playback”:**
- Confirm the Developer folder is the **parent** of `companion-module` (e.g. `…\PHOTO PLAYER`, not `…\PHOTO PLAYER\companion-module`).
- Ensure **Enable Developer Modules** is ON.
- Restart Companion or disable/re-enable the developer path.
- Check Companion’s log (and enable debug) for errors loading the module.

### Option B: Import package (.tgz)

1. Build the package: `cd companion-module`, then `npm install` and `npm run package` (or `yarn package`). Use the generated `.tgz` if the build succeeds on your machine.
2. In Companion: **Connections** → **Import module package** (or **Developer** → **Import module from file**) and select the `.tgz` file.

## Repo layout

- **companion/** – Railway API (HTTP + WebSocket). Deploy to Railway.
- **companion-module/** – This Companion module. Install in Bitfocus Companion to get the presets and feedback.
