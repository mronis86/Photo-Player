# Group timing and crossfade — spec for external agents

Use this document to understand or fix group crossfade behavior and Ken Burns motion continuity in the photo playout app.

---

## 1. Overview

- **Controller**: React app that builds a “program” (list of cues/items). User can play a **group** (multiple images) with a single hold duration per image and a **crossfade** between images.
- **Playout**: Separate window that receives messages (BroadcastChannel + postMessage) and displays the current image fullscreen with **Ken Burns** (zoom/pan) animation.
- **Goal**: When a group has crossfade (e.g. 1 s), image 1 and image 2 should overlap for that 1 s with a smooth opacity crossfade, and the **zoom/pan motion must not jump** at the start or end of the crossfade.

---

## 2. Timing model (A/B timeline)

Like a video editor: each image is a **layer** with a **start time** and **duration** on a single timeline. Crossfade is the overlap between adjacent layers.

- **Group**: N images. **Hold** = per-image “slot” in seconds (e.g. 10 s). **Crossfade duration**: e.g. 1 s (configurable per group).
- **Total group duration** = N × hold (unchanged; e.g. 3 × 10 = 30 s).

**Per-image timeline (index i, 0-based):**

| Index i | Start time (s)           | Layer duration (s)   | End time (s)   |
|---------|---------------------------|----------------------|----------------|
| 0       | 0                         | hold                 | hold           |
| 1..N−1  | i×hold − crossfadeDur     | hold + crossfadeDur  | (i+1)×hold     |

Example (3 images, hold 10 s, crossfade 1 s):
- **Image 1**: start 0 s, duration **10 s** (solo 0–10).
- **Image 2**: start **9 s**, duration **11 s** (crossfade 9–10, then solo 10–20).
- **Image 3**: start **19 s**, duration **11 s** (crossfade 19–20, then solo 20–30).

**Controller behaviour:**
- Send image i when `elapsed >= startTime[i]` (once per transition, tracked by a ref).
- For image i, pass `holdDuration = layerDuration[i]`: first image gets `hold`, rest get `hold + crossfadeDur`.
- For images 1..N−1 (crossfade-next), also pass `crossfadeLeadIn: groupCrossfadeDur` so playout knows the layer was already on during the crossfade and can set EOC/progress to the **remaining** time (hold) after commit.
- Advance “current image index” at slot boundaries: `currentImageIdx = floor(elapsed / hold)` (unchanged).

**Playout:** When a payload has `crossfadeLeadIn`, use `effectiveHold = holdDuration - crossfadeLeadIn` for EOC timer and progress bar after commit (so the layer ends after 10 s remaining, not 11 s).

---

## 3. Playout behavior (two-layer crossfade)

- **Message**: `{ type: 'play', ...payload }`. Payload includes `src`, `holdDuration`, `transitionType`, `transDuration`, `kbDur`, Ken Burns params, etc. For group crossfade-next images, `holdDuration` may be longer than the slot hold (hold + crossfadeDur); optional `crossfadeLeadIn` indicates seconds already “on” before commit.
- **Crossfade condition**: When playout **already has a current payload** and the new play has `transitionType === 'fade'` and `transDuration > 0`, it treats this as a **crossfade** (not a hard cut).
- **Actions on crossfade play**:
  - Cancel any EOC (end-of-cue) timer for the current image so it doesn’t clear the screen during the crossfade.
  - Set **nextPayload** = incoming payload, **crossfadeOutOpacity** = 1, **crossfadeInOpacity** = 0, **crossfadeDuration** = transDuration.
- **Render**: While **nextPayload** is set, playout renders **two** program layers:
  - **Outgoing**: current `payload`, opacity = crossfadeOutOpacity, transition = `opacity ${crossfadeDuration}s ease`, zIndex 10.
  - **Incoming**: nextPayload, opacity = crossfadeInOpacity, same transition, zIndex 11.
- **Animation**: After ~50 ms, set crossfadeOutOpacity → 0 and crossfadeInOpacity → 1 so both layers animate over crossfadeDuration.
- **Commit**: After crossfadeDuration + 100 ms, set payload = nextPayload, nextPayload = null, reset opacities. Only one layer is shown again.

---

## 4. Ken Burns and the “jump” problem

Each image uses a **Ken Burns** animation: zoom/pan over `kbDur` seconds (derived from hold and motion speed). It can be a CSS keyframe preset (e.g. zoom-in) or **custom** keyframes (start/end transform).

**Linear A/B motion (no jump)**  
Each layer runs its Ken Burns **linearly** from 0% to 100%; we only fade opacity at the right moments.

- **Incoming layer (B)**: Start at **0%** — no progress sync, no negative animation-delay. Layer B runs from 0% to 100% over its full `kbDur`. We only fade B in (opacity 0→1) during the crossfade. This avoids timing/curve glitches from syncing to the outgoing layer.
- **On commit**: Do **not** jump to the end frame. The incoming layer has been playing for `crossfadeDuration` seconds. Set `kbContinueFromSecondsRef = crossfadeDuration` (not `kbDur`). The main layer then continues from that point and runs linearly to the end. This avoids the “jump back” that happened when we forced the main layer to the end frame (100%).

---

## 5. Relevant files and symbols

- **Controller (sends play at timeline start)**  
  - `src/components/controller/Controller.tsx`  
  - `getGroupLayerTimeline(n, hold, crossfadeDur)` returns `getStartTime(i)` and `getLayerDuration(i)` for the A/B timeline.  
  - Tick uses `elapsed`, `currentDisplayedIdx`, `currentImageIdx`; sends next image when `betweenTrans === 'crossfade'` and `elapsed >= timeline.getStartTime(nextIdx)` (once per transition).  
  - Crossfade-next payload uses `holdDuration: timeline.getLayerDuration(nextIdx)` (hold + crossfadeDur for i ≥ 1) and `crossfadeLeadIn: groupCrossfadeDur`.  
  - Builds payload with `buildPlayoutPayload` (from `src/lib/buildPlayoutPayload.ts`). Sends via `sendPlayPayload` (from `src/lib/playoutChannel.ts`).

- **Playout stage (two-layer crossfade + KB)**  
  - `src/components/playout/Stage.tsx`  
  - Listens for `type: 'play'`; if `payloadRef.current != null` and `transitionType === 'fade'` and `transDuration > 0` → crossfade path: set nextPayload, opacities, cancel EOC timer.  
  - Crossfade effect: after 50 ms set opacities to 0/1; after crossfadeDuration + 100 ms commit (set payload = nextPayload, set `kbContinueFromSecondsRef` for end-frame continuity).  
  - **EOC / progress**: when payload has `crossfadeLeadIn`, use `effectiveHold = holdDuration - crossfadeLeadIn` for EOC timer and progress bar.  
  - **Main KB effect**: `kbRef`, applies animation from `payload`; reads `kbContinueFromSecondsRef` and applies negative animation-delay when set.  
  - **Next-layer KB effect**: `kbRefNext`, applies animation from `nextPayload`; starts at 0% (linear only, no progress sync).  
  - Two-layer render: when `nextPayload && imgSrcNext`, render outgoing div (zIndex 10, crossfadeOutOpacity) and incoming div (zIndex 11, crossfadeInOpacity), each with full content (fullscreen/blurbg/split + captions).

- **Types / payload**  
  - `src/lib/types.ts`: PlayoutPayload has `holdDuration`, `kbDur`, `transitionType`, `transDuration`, `crossfadeLeadIn` (optional), etc.  
  - `src/lib/buildPlayoutPayload.ts`: builds payload with `getCueHoldDuration`, `getKBDuration` (for kbDur); accepts optional `crossfadeLeadIn` and passes it through.

- **Ken Burns helpers**  
  - `src/lib/controllerHelpers.ts`: `getKBAnimationName`, `applyCustomKBKeyframes`, `applyCustomKBKeyframesFromXYZ`, etc.  
  - Used by Stage to apply preset or custom KB; both support `element.style.animationDelay` for offset.

---

## 6. Current issue (what’s not working)

- **Observed**: There are still **jumps in zoom/motion** at the **start** and **end** of each crossfade (e.g. image 1→2 and 2→3).
- **Already implemented** (for reference):
  - Controller sends next image at crossfadeStart (hold − crossfadeDur).
  - Playout does two-layer crossfade with opacity transition and commits after crossfadeDuration.
  - EOC timer is cancelled when crossfade play is received.
  - Incoming layer: `startOffset = outElapsed * (nextPayload.kbDur / payload.kbDur)` and applied as negative animation-delay.
  - On commit: `kbContinueFromSecondsRef = nextPayload.kbDur` and main KB effect applies that as negative animation-delay so the main layer shows the end frame.

If jumps persist, possible causes to investigate:

1. **Timing**: `payload.holdDuration` or `payload.kbDur` / `nextPayload.kbDur` might be wrong or not in sync (e.g. per-cue overrides, or buildPlayoutPayload using different duration than the controller’s hold).
2. **Custom Ken Burns**: Custom keyframes might be applied in a way that doesn’t respect `animationDelay` (e.g. different element or keyframe structure). Check `applyCustomKBKeyframesFromXYZ` and custom path in both KB effects.
3. **Preset vs custom**: Preset animations use a single duration; custom might use different timing or keyframe range. Ensure “progress” (0–100%) is defined consistently for both.
4. **Commit timing**: The commit runs after `crossfadeDuration * 1000 + 100` ms. If the opacity transition or the incoming animation doesn’t end exactly there, the “end frame” we’re trying to match might be wrong.
5. **Ref/state order**: When we set `payload = nextPayload` and then the main KB effect runs, it must read `kbContinueFromSecondsRef` **before** it’s cleared; confirm the effect runs in the same commit cycle and ref is read once and cleared.

---

## 7. Minimal test case

- Group of 3 images, 10 s hold each, 1 s crossfade.
- At 9 s: controller sends image 2 with transitionType `'fade'`, transDuration `1`. Playout shows image 1 and 2 with 1 s opacity crossfade; both layers have Ken Burns.
- At 10 s: controller advances index to 2; no new play. Playout has already committed (payload = image 2, single layer).
- At 19 s: controller sends image 3 (crossfade). Same behavior.
- At 20 s: advance to 3.

Expected: No visible jump in zoom/pan at 9 s, 10 s, 19 s, or 20 s. Crossfade should be smooth and motion continuous.

---

*End of spec*
