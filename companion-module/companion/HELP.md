# FotoFlow: Image Motion Playback

Control FotoFlow Image Motion Playback from Bitfocus Companion. Uses the **same 6-character connection code** as the playout window. Talks to your Railway Companion API.

## Configuration

- **API Base URL** – Your Railway Companion API URL (e.g. `https://your-app.up.railway.app`). No trailing slash.
- **Connection Code** – 6-character code from the controller (same code the playout window uses).
- **Poll interval** – How often to fetch state for feedback (5–120 seconds).

## Actions

- **Take** – Preview → Program
- **Next** – Select next cue as NEXT
- **Prev** – Select previous as NEXT
- **Go to cue** – Go to cue by index (0-based)
- **Clear** – Clear program (cut to black)
- **Fade** – Fade to black or transparent

## Presets

- **Transport:** Take, Next, Prev, Clear, Fade to black, Fade to transparent
- **Cues:** One preset per cue (with live/next feedback), or Cue 0–9 when no cues loaded

## Feedbacks

- **Live cue is** – Highlight when selected cue index is on program
- **Next cue is** – Highlight when selected cue index is next
- **Playout connected** – Playout window is connected
- **Is live** – Program has a cue
- **Button text: cue name** – Show cue name by index

## Variables

- `live_index`, `next_index`, `is_live`, `playout_connected`, `cue_count`, `live_cue_name`, `next_cue_name`
