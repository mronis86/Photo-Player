# Custom Point Mode – Code Reference for External Debugging

This document contains all code related to **custom Ken Burns** mode, where the user sets **Start** and **End** position data (X, Y, Z) to drive a zoom/pan animation. The program output should match these position values; the blue “START”/“END” boxes in the UI are kept in sync but **position data (kbStartCx, kbStartCy, kbStartZ, kbEndCx, kbEndCy, kbEndZ) is the source of truth** for the transform.

**Coordinate system:**
- **X, Y**: center of the crop in 0–100 (50, 50 = image center).
- **Z**: zoom level (1 = full frame; 2 = 2× zoom). Advanced “Zoom scale” multiplies Z.
- **Transform formula:** `effectiveZ = clamp(z * zoomScaleMult, 0.5, 10)`; `tx = effectiveZ <= 1 ? 0 : 50 - cx`; `ty = effectiveZ <= 1 ? 0 : 50 - cy`; CSS: `translate(tx%, ty%) scale(effectiveZ)`.

---

## 1. Types – `src/lib/types.ts`

### KbPoint (rectangle in 0–100 space)
```ts
export interface KbPoint {
  x: number;
  y: number;
  w: number;
  h: number;
}
```

### Cue – custom fields
```ts
// On Cue interface:
  kbCustomStart?: KbPoint;
  kbCustomEnd?: KbPoint;
  /** When set, these are used for the transform (source of truth); otherwise derived from rectangles */
  kbStartCx?: number;
  kbStartCy?: number;
  kbStartZ?: number;
  kbEndCx?: number;
  kbEndCy?: number;
  kbEndZ?: number;
```

### PlayoutPayload – custom fields
```ts
  kbCustomStart: KbPoint | null;
  kbCustomEnd: KbPoint | null;
  /** When set, playout uses these for custom keyframes (source of truth) */
  kbStartCx?: number;
  kbStartCy?: number;
  kbStartZ?: number;
  kbEndCx?: number;
  kbEndCy?: number;
  kbEndZ?: number;
```

---

## 2. Controller helpers – `src/lib/controllerHelpers.ts`

### Rectangle ↔ center+zoom conversion
```ts
export function kbPointToXYZ(pt: KbPoint): { cx: number; cy: number; z: number } {
  const cx = pt.x + pt.w / 2;
  const cy = pt.y + pt.h / 2;
  const z = Math.max(1, 100 / Math.max(pt.w, pt.h));
  return { cx, cy, z };
}

export function xyzToKbPoint(cx: number, cy: number, z: number): KbPoint {
  const w = Math.max(10, Math.min(100, 100 / z));
  const h = w / (16 / 9);
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = Math.max(0, Math.min(100 - w, x));
  y = Math.max(0, Math.min(100 - h, y));
  return { x, y, w, h };
}
```

### CSS transform from (cx, cy, z)
```ts
export function getCustomKBTransformFromXYZ(
  cx: number,
  cy: number,
  z: number,
  zoomScaleMult: number = 1
): string {
  const effectiveZ = Math.max(0.5, Math.min(10, z * zoomScaleMult));
  const tx = effectiveZ <= 1 ? 0 : 50 - cx;
  const ty = effectiveZ <= 1 ? 0 : 50 - cy;
  return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${effectiveZ.toFixed(4)})`;
}
```

### Effective Start/End XYZ from cue (direct fields override rectangles)
```ts
export function getCueStartXYZ(cue: Cue): { cx: number; cy: number; z: number } | null {
  if (cue.kbStartCx != null && cue.kbStartCy != null && cue.kbStartZ != null)
    return { cx: cue.kbStartCx, cy: cue.kbStartCy, z: cue.kbStartZ };
  if (cue.kbCustomStart) return kbPointToXYZ(cue.kbCustomStart);
  return null;
}

export function getCueEndXYZ(cue: Cue): { cx: number; cy: number; z: number } | null {
  if (cue.kbEndCx != null && cue.kbEndCy != null && cue.kbEndZ != null)
    return { cx: cue.kbEndCx, cy: cue.kbEndCy, z: cue.kbEndZ };
  if (cue.kbCustomEnd) return kbPointToXYZ(cue.kbCustomEnd);
  return null;
}
```

### Apply keyframes from XYZ (used by controller preview and could be used by playout)
```ts
export function applyCustomKBKeyframesFromXYZ(
  kbEl: HTMLElement,
  start: { cx: number; cy: number; z: number },
  end: { cx: number; cy: number; z: number },
  dur: number,
  zoomScaleMult: number = 1
): void {
  const fromCss = getCustomKBTransformFromXYZ(start.cx, start.cy, start.z, zoomScaleMult);
  const toCss = getCustomKBTransformFromXYZ(end.cx, end.cy, end.z, zoomScaleMult);
  customKbCounter += 1;
  const name = `kbC${customKbCounter}`;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-kb-custom', '1');
  styleEl.textContent = `@keyframes ${name}{from{transform:${fromCss}}to{transform:${toCss}}}`;
  document.head.appendChild(styleEl);
  const all = document.querySelectorAll('style[data-kb-custom]');
  if (all.length > 30) all[0].remove();
  kbEl.style.transformOrigin = '50% 50%';
  kbEl.style.animation = `${name} ${dur}s linear forwards`;
}
```

---

## 3. Controller UI – `src/components/controller/Controller.tsx`

### Constants and default rectangles
```ts
const KB_ASPECT = 16 / 9;
function kbPoint16x9(x: number, y: number, w: number): KbPoint {
  return { x, y, w, h: w / KB_ASPECT };
}
const DEFAULT_KB_START: KbPoint = kbPoint16x9(5, 10, 50);
const DEFAULT_KB_END: KbPoint = kbPoint16x9(40, 25, 45);
```

### Ensure default when switching to custom (sets both rectangles and direct XYZ)
```ts
useEffect(() => {
  if (panelKbDirection !== 'custom' || !previewCueId) return;
  setCues((prev) =>
    prev.map((c) => {
      if (c.id !== previewCueId) return c;
      if (c.kbCustomStart && c.kbCustomEnd) return c;
      const start = c.kbCustomStart ?? DEFAULT_KB_START;
      const end = c.kbCustomEnd ?? DEFAULT_KB_END;
      const startXYZ = kbPointToXYZ(start);
      const endXYZ = kbPointToXYZ(end);
      return { ...c, kbCustomStart: start, kbCustomEnd: end, kbStartCx: startXYZ.cx, kbStartCy: startXYZ.cy, kbStartZ: startXYZ.z, kbEndCx: endXYZ.cx, kbEndCy: endXYZ.cy, kbEndZ: endXYZ.z };
    })
  );
}, [panelKbDirection, previewCueId]);
```

### Drag/resize: update both rectangle and direct XYZ
```ts
const xyz = kbPointToXYZ(upd);
setCues((prev) =>
  prev.map((c) => {
    if (c.id !== previewCueId) return c;
    if (d.active === 'start') return { ...c, kbCustomStart: upd, kbStartCx: xyz.cx, kbStartCy: xyz.cy, kbStartZ: xyz.z };
    return { ...c, kbCustomEnd: upd, kbEndCx: xyz.cx, kbEndCy: xyz.cy, kbEndZ: xyz.z };
  })
);
```

### X/Y/Z inputs – read from getCueStartXYZ / getCueEndXYZ; on change set both direct XYZ and rectangle
Example for Start X (others follow same pattern):
```ts
value={previewCue ? Math.round((getCueStartXYZ(previewCue) ?? { cx: 50, cy: 50, z: 1 }).cx) : 50}
onChange={(e) => {
  const v = Number(e.target.value);
  if (!previewCueId || !previewCue) return;
  const cur = getCueStartXYZ(previewCue) ?? { cx: 50, cy: 50, z: 1 };
  const pt = xyzToKbPoint(v, cur.cy, cur.z);
  setCues((prev) => prev.map((c) => c.id === previewCueId ? { ...c, kbCustomStart: pt, kbStartCx: v, kbStartCy: cur.cy, kbStartZ: cur.z } : c));
}}
```

### Swap (rectangles + direct XYZ)
```ts
if (c.id !== previewCueId || !c.kbCustomStart || !c.kbCustomEnd) return c;
return { ...c, kbCustomStart: c.kbCustomEnd, kbCustomEnd: c.kbCustomStart, kbStartCx: c.kbEndCx, kbStartCy: c.kbEndCy, kbStartZ: c.kbEndZ, kbEndCx: c.kbStartCx, kbEndCy: c.kbStartCy, kbEndZ: c.kbStartZ };
```

### Reset (rectangles + direct XYZ to defaults)
```ts
const s = kbPointToXYZ(DEFAULT_KB_START), e = kbPointToXYZ(DEFAULT_KB_END);
return { ...c, kbCustomStart: DEFAULT_KB_START, kbCustomEnd: DEFAULT_KB_END, kbStartCx: s.cx, kbStartCy: s.cy, kbStartZ: s.z, kbEndCx: e.cx, kbEndCy: e.cy, kbEndZ: e.z };
```

---

## 4. Monitor (preview) – `src/components/controller/MonitorLayer.tsx`

Custom keyframes use effective XYZ when available; otherwise rectangles.
```ts
const startXYZ = getCueStartXYZ(cue);
const endXYZ = getCueEndXYZ(cue);
const isCustomXYZ = (cue.kbAnim === 'custom' || kbDirection === 'custom') && startXYZ && endXYZ;
const isCustomRect = (cue.kbAnim === 'custom' || kbDirection === 'custom') && cue.kbCustomStart && cue.kbCustomEnd;
if (staticKeyframe && isCustomXYZ) {
  const xyz = staticKeyframe === 'start' ? startXYZ : endXYZ;
  el.style.transform = getCustomKBTransformFromXYZ(xyz.cx, xyz.cy, xyz.z, kbScale);
} else if (isCustomXYZ) {
  applyCustomKBKeyframesFromXYZ(el, startXYZ, endXYZ, kbDur, kbScale);
} else if (isCustomRect) {
  applyCustomKBKeyframes(el, cue.kbCustomStart, cue.kbCustomEnd, kbDur, kbScale);
} else {
  // preset animation
}
```

---

## 5. Playout payload – `src/lib/buildPlayoutPayload.ts`

Add direct XYZ to payload when cue has start/end:
```ts
import { getCueStartXYZ, getCueEndXYZ } from './controllerHelpers';

// inside buildPlayoutPayload:
const startXYZ = getCueStartXYZ(cue);
const endXYZ = getCueEndXYZ(cue);
const directXYZ = startXYZ && endXYZ
  ? { kbStartCx: startXYZ.cx, kbStartCy: startXYZ.cy, kbStartZ: startXYZ.z, kbEndCx: endXYZ.cx, kbEndCy: endXYZ.cy, kbEndZ: endXYZ.z }
  : {};

return {
  // ...
  kbCustomStart: cue.kbCustomStart ?? null,
  kbCustomEnd: cue.kbCustomEnd ?? null,
  ...directXYZ,
  // ...
};
```

---

## 6. Playout HTML – `frameflow-playout.html`

### Transform from (cx, cy, z) – must match controller formula
```js
function xyz2css(cx, cy, z, zoomScaleMult) {
  const mult = zoomScaleMult == null ? 1 : Number(zoomScaleMult);
  const effectiveZ = Math.max(0.5, Math.min(10, z * mult));
  const tx = effectiveZ <= 1 ? 0 : 50 - cx;
  const ty = effectiveZ <= 1 ? 0 : 50 - cy;
  return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${effectiveZ.toFixed(4)})`;
}
```

### Apply custom keyframes from rectangle (fallback)
```js
function applyCustomKB(kbEl, start, end, dur, zoomScaleMult) {
  const pt2css = pt => {
    const cx = pt.x + pt.w / 2, cy = pt.y + pt.h / 2;
    const z = Math.max(1, 100 / Math.max(pt.w, pt.h));
    return xyz2css(cx, cy, z, zoomScaleMult);
  };
  const c = (window._kbC = (window._kbC || 0) + 1), name = `kbC${c}`;
  const s = document.createElement('style');
  s.textContent = `@keyframes ${name}{from{transform:${pt2css(start)}}to{transform:${pt2css(end)}}}`;
  document.head.appendChild(s);
  kbEl.style.transformOrigin = '50% 50%';
  kbEl.style.animation = `${name} ${dur}s linear forwards`;
}
```

### Apply custom keyframes from direct XYZ (preferred when payload has them)
```js
function applyCustomKBFromXYZ(kbEl, startCx, startCy, startZ, endCx, endCy, endZ, dur, zoomScaleMult) {
  const fromCss = xyz2css(startCx, startCy, startZ, zoomScaleMult);
  const toCss = xyz2css(endCx, endCy, endZ, zoomScaleMult);
  const c = (window._kbC = (window._kbC || 0) + 1), name = `kbC${c}`;
  const s = document.createElement('style');
  s.textContent = `@keyframes ${name}{from{transform:${fromCss}}to{transform:${toCss}}}`;
  document.head.appendChild(s);
  kbEl.style.transformOrigin = '50% 50%';
  kbEl.style.animation = `${name} ${dur}s linear forwards`;
}
```

### In renderFrame(d) – use direct XYZ when present
```js
const kbEl = newLayer.querySelector('.kb-layer');
if (kbEl) {
  if (d.kbAnim === 'custom') {
    kbEl.style.setProperty('--ks', '1');
    if (d.kbStartCx != null && d.kbStartCy != null && d.kbStartZ != null && d.kbEndCx != null && d.kbEndCy != null && d.kbEndZ != null) {
      applyCustomKBFromXYZ(kbEl, d.kbStartCx, d.kbStartCy, d.kbStartZ, d.kbEndCx, d.kbEndCy, d.kbEndZ, d.kbDur, d.kbScale);
    } else if (d.kbCustomStart && d.kbCustomEnd) {
      applyCustomKB(kbEl, d.kbCustomStart, d.kbCustomEnd, d.kbDur, d.kbScale);
    }
  } else {
    // preset animations
  }
}
```

---

## 7. Data flow summary

1. **Controller:** User edits X/Y/Z or drags boxes → cue gets `kbStartCx/Cy/Z` and `kbEndCx/Cy/Z` (and rectangles for display).
2. **buildPlayoutPayload:** Reads `getCueStartXYZ(cue)` / `getCueEndXYZ(cue)` and adds `kbStartCx`, `kbStartCy`, `kbStartZ`, `kbEndCx`, `kbEndCy`, `kbEndZ` to the payload.
3. **Playout:** If payload has all six numbers, uses `applyCustomKBFromXYZ`; otherwise uses `kbCustomStart` / `kbCustomEnd` with `applyCustomKB`.
4. **Transform:** Same in TS and HTML: `effectiveZ = clamp(z * zoomScaleMult, 0.5, 10)`, `tx = effectiveZ <= 1 ? 0 : 50 - cx`, `ty = effectiveZ <= 1 ? 0 : 50 - cy`, then `translate(tx%, ty%) scale(effectiveZ)`.

If the program output does not match the set position data, check: (1) payload actually contains `kbStartCx` etc. when sent to playout; (2) playout receives and uses them (e.g. no renames or stripping); (3) `d.kbScale` in playout is the same zoom scale as in the controller; (4) the image in playout has the same aspect and is in a container that uses the same transform-origin and coordinate system.
