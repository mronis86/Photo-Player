# Ken Burns Preset Modes – Fix Black Edges / Out-of-Bounds

Use this document to fix the preset Ken Burns motions (AUTO, ZOOM IN, ZOOM OUT, PAN LEFT, PAN RIGHT, DRIFT) so that in **FILL** mode they **never show black edges** and **never show content outside the image bounds**.

---

## 1. Problem

- **Black edges:** The content area shows black (stage background) around the image – the image is not filling the frame enough during the motion.
- **Out of bounds:** Motion should not pan/zoom so far that we see beyond the image (empty space or image edges).

So the fix must achieve both:

1. **Image always fills the viewport** – no black bars or black edges visible at any point in the animation.
2. **Motion stays within the image** – no pan/zoom that reveals area outside the photo.

---

## 2. How It Works

### DOM structure

```
#stage (black background, overflow: hidden)
  └── .play-layer (position: absolute, inset: 0)
        └── .kb-layer (position: absolute, inset: 0; transform applied HERE; transform-origin: 50% 50%)
              └── img.fill (width: 100%; height: 100%; object-fit: cover)
```

- The **stage** has a black background. Anything not covered by the image shows as black.
- The **Ken Burns transform** (scale + translate) is applied to **`.kb-layer`**, not to the img.
- The **img** has `object-fit: cover` (FILL mode), so it always fills `.kb-layer` and is cropped to cover.

### Preset animations

Presets are **CSS keyframe animations** applied to `.kb-layer`:

| Preset   | Keyframe name | Intent                          |
|----------|---------------|----------------------------------|
| AUTO     | usually kb-zi | Same as Zoom-in                  |
| Zoom-in  | kb-zi         | Start at scale 1, end zoomed in   |
| Zoom-out | kb-zo         | Start zoomed in, end at scale 1   |
| Pan right| kb-pr         | Pan from left to right            |
| Pan left | kb-pl         | Pan from right to left            |
| Drift    | kb-dr         | Slight zoom + slight pan          |

The app sets a CSS variable **`--ks`** (zoom scale) on `.kb-layer` before starting the animation. Values come from the user’s “Zoom scale” setting.

### Where `--ks` comes from

- **File:** `src/lib/controllerHelpers.ts`
- **Function:** `getKBScaleVar(cue, zoomScale)` 
- **Values:** `ZOOM_SCALE_VALUES = [1, 1.05, 1.1, 1.18, 1.28]` (user setting 1–5 maps to these).
- The playout payload and controller pass this as `kbScale`; the React playout and MonitorLayer set `el.style.setProperty('--ks', String(scale))`.

So **`--ks` can be 1, 1.05, 1.1, 1.18, or 1.28**. Keyframes use it like `scale(var(--ks, 1.12))`.

### CSS transform behavior

- **Order in `transform: scale(...) translate(...)`:** In CSS, the rightmost function is applied first in the element’s local coordinate system. So the element is first **translated**, then **scaled** from `transform-origin: 50% 50%`.
- **Percentages in `translate()`:** They are relative to the **element’s own size** (the `.kb-layer`), which is the same as the viewport (100vw × 100vh). So `translate(5%, 0)` moves by 5% of the viewport width.

### Constraint so we don’t show image edges (stay in bounds)

When the layer is scaled by **S** (e.g. 1.12):

- The layer (and the image) is **S** times larger than the viewport.
- So there is “overflow” of **(S − 1)** in total, or **(S − 1) / 2** on each side from center.
- So the **maximum safe translate** (so we don’t reveal the image edge) is about **50 × (S − 1)%** in each direction (e.g. S = 1.12 → ~6% max translate per side).

If **translate** is larger than that (for the scale you use), the crop can move past the image and show empty space or edges.

### Why black edges might appear

- **Scale &lt; 1:** If the keyframes ever use `scale(1)` or a value less than 1, the layer can become smaller than the viewport and black will show. So the **minimum scale in the keyframes should be 1** (or slightly above) if we must never show black.
- **Large translate:** A large translate can move the scaled layer so that one side of the viewport is no longer covered by the layer, again revealing black. So **translate** must be kept within the “safe” range for the scale used.
- **Overflow / clipping:** The stage has `overflow: hidden`, so the layer is clipped to the stage. If the layer is scaled up (S &gt; 1) and translated, it should still cover the full stage as long as we don’t translate so far that the viewport “window” looks at empty space. So black usually means either scale is too small somewhere or the combination of scale and translate is wrong.

---

## 3. Files to Change

You must keep **all three** in sync (same keyframes and same `.kb-layer` rules):

| File | Purpose |
|------|--------|
| `src/styles/controller.css` | Controller preview (PVW/PGM monitors) |
| `src/styles/playout.css` | React playout window (Stage.tsx) |
| `frameflow-playout.html` | Standalone HTML playout (inline `<style>`) |

In each file:

1. Find the **`.kb-layer`** rule and ensure **`transform-origin: 50% 50%`** is set.
2. Find the **`@keyframes kb-zi`**, **kb-zo**, **kb-pr**, **kb-pl**, **kb-dr** definitions and adjust scale/translate so that:
   - At every keyframe, the image still **fully covers** the viewport (no black).
   - Translate never exceeds the safe amount for the scale used (so we don’t go out of image bounds).

---

## 4. Current Keyframes (as of last edit)

These are the keyframes that were intended to be “conservative” but still produced black edges. Use them as a starting point and adjust.

**controller.css / playout.css:**

```css
.kb-layer { position: absolute; inset: 0; will-change: transform; transform-origin: 50% 50%; }
.kb-layer img.fill { width: 100%; height: 100%; object-fit: cover; }

/* Preset Ken Burns */
@keyframes kb-zi { from { transform: scale(1) translate(0, 0); } to { transform: scale(var(--ks, 1.12)) translate(-1.5%, -1.5%); } }
@keyframes kb-zo { from { transform: scale(var(--ks, 1.12)) translate(-1.5%, -1.5%); } to { transform: scale(1) translate(0, 0); } }
@keyframes kb-pr { from { transform: scale(var(--ks, 1.08)) translate(-2%, 0); } to { transform: scale(var(--ks, 1.08)) translate(2%, 0); } }
@keyframes kb-pl { from { transform: scale(var(--ks, 1.08)) translate(2%, 0); } to { transform: scale(var(--ks, 1.08)) translate(-2%, 0); } }
@keyframes kb-dr { from { transform: scale(1.04) translate(-1%, -1%); } to { transform: scale(var(--ks, 1.1)) translate(1%, 1%); } }
```

**frameflow-playout.html:** Same keyframes and same `.kb-layer` rule appear in the inline `<style>` block (search for `kb-zi` or `kb-layer`).

---

## 5. What to Try

1. **Ensure minimum scale is never below 1**  
   Replace any `scale(1)` in the keyframes with a minimum of `scale(1)` and ensure the layer never shrinks so that black shows. If the stage or parent has a different size than the layer, verify that the layer always fully covers the visible area at every keyframe.

2. **Ensure the layer always covers the viewport**  
   For any `scale(S)` and `translate(X%, Y%)`, check that the transformed layer still fully covers the stage. With `transform-origin: 50% 50%`, the “safe” translate depends on S (see constraint above). If you need to avoid black, you may need to **increase the minimum scale** (e.g. never go below 1.02) and/or **reduce the maximum translate** so the viewport is always covered.

3. **Keep translate in the safe range**  
   For a given scale **S**, keep **|translate| ≤ 50 × (S − 1)%** (roughly) so the crop doesn’t move past the image. You can tune this with a small safety margin.

4. **Optional: adjust zoom scale range**  
   If the presets still show black even with the above, consider raising the **minimum** value of `--ks` in `src/lib/controllerHelpers.ts` (e.g. so the smallest zoom is 1.05 instead of 1), or ensure keyframes never use a scale below that minimum.

5. **Test in all three places**  
   After changing keyframes, test:
   - Controller preview (PVW/PGM) – uses `controller.css`
   - React playout window – uses `playout.css`
   - Standalone `frameflow-playout.html` if you use it

---

## 6. Quick Reference – Keyframe Names and --ks

- **kb-zi** = Zoom in  
- **kb-zo** = Zoom out  
- **kb-pr** = Pan right  
- **kb-pl** = Pan left  
- **kb-dr** = Drift  

**--ks** is set by the app to one of: **1, 1.05, 1.1, 1.18, 1.28**. Use `var(--ks, <fallback>)` in keyframes so they still work if the variable is missing.

---

## 7. Where Animation Is Applied in Code

- **Controller preview (MonitorLayer):** `src/components/controller/MonitorLayer.tsx` – applies animation to `kbRef.current` (the `.kb-layer` div), setting `--ks` and `el.style.animation = '<name> <dur>s linear forwards'`.
- **React playout (Stage):** `src/components/playout/Stage.tsx` – same: sets `--ks` and animation on the `.kb-layer` ref in a `useEffect` when `payload` changes.
- **Custom Ken Burns** uses different logic (custom keyframes from `controllerHelpers.ts`: `applyCustomKBKeyframes` / `applyCustomKBKeyframesFromXYZ`). This document is only for the **preset** keyframes above.

Editing the keyframes in the three CSS/style locations is enough to fix the preset modes; no change to React code is required unless you also want to change how `--ks` is computed or passed.
