import type { Cue, Group, ModeOpts, CaptionStyle, EndOfCue, TransitionType, BetweenImageTransition, KbPoint, WipeDirection } from './types';

/** 1 = 1:1, then 1.05–1.28. Custom motion always uses 1:1. */
const ZOOM_SCALE_VALUES = [1, 1.05, 1.1, 1.18, 1.28] as const;

/** Minimum zoom for preset motions (Zoom In/Out, Pan, Drift) so we're never at 1:1 and motion is visible without black edges. */
export const PRESET_MIN_ZOOM = 1.12;
const MOTION_SPEED_MULT = [1.5, 1.2, 1, 0.8, 0.6] as const;
const KB_ANIM_MAP: Record<string, string> = {
  'zoom-in': 'kb-zi',
  'zoom-out': 'kb-zo',
  'pan-right': 'kb-pr',
  'pan-left': 'kb-pl',
  drift: 'kb-dr',
};

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Incoming wipe layer: revealPct 100 = fully clipped (hidden), 0 = fully revealed. */
export function getWipeClipPath(direction: WipeDirection, revealPct: number): string {
  const hidden = Math.max(0, Math.min(100, revealPct));
  const p = (100 - hidden) / 100; // 0 = nothing visible, 1 = all visible
  // Legacy: treat old 'diagonal' as diagonal-tl-br
  const d: WipeDirection = (direction as string) === 'diagonal' ? 'diagonal-tl-br' : direction;

  switch (d) {
    case 'left':
      return `inset(0 0 0 ${hidden}%)`;
    case 'right':
      return `inset(0 ${hidden}% 0 0)`;
    case 'up':
      return `inset(${hidden}% 0 0 0)`;
    case 'down':
      return `inset(0 0 ${hidden}% 0)`;
    case 'diagonal-tl-br': {
      // Hard line TL→BR: visible = x+y <= 200p
      if (p <= 0) return 'polygon(0% 0%, 0% 0%, 0% 0%)';
      if (p >= 1) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
      const x = Math.min(100, 200 * p);
      if (p <= 0.5) return `polygon(0% 0%, ${x}% 0%, 0% ${x}%)`;
      return `polygon(0% 0%, 100% 0%, 100% ${200 * p - 100}%, ${200 * p - 100}% 100%, 0% 100%)`;
    }
    case 'diagonal-br-tl': {
      // Hard line TL→BR: visible = x+y >= 200(1-p)
      const L = 200 * (1 - p);
      if (L >= 200) return 'polygon(0% 0%, 0% 0%, 0% 0%)';
      if (L <= 0) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
      if (L >= 100) return `polygon(100% 100%, 100% ${100 - L}%, ${100 - L}% 100%)`;
      return `polygon(100% 100%, 100% 0%, 0% 0%, 0% 100%, ${100 - L}% 100%, 100% ${100 - L}%)`;
    }
    case 'diagonal-tr-bl': {
      // Hard line TR→BL: visible = x+y >= 100-200p (reveal from TR)
      const L = 100 - 200 * p;
      if (L >= 100) return `polygon(100% 0%, 100% 100%, 0% 100%)`;
      if (L <= 0) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
      return `polygon(100% 0%, 100% 100%, 0% 100%, 0% ${L}%, ${L}% 0%)`;
    }
    case 'diagonal-bl-tr': {
      // Hard line TR→BL: visible = x+y >= 300-200p (reveal from BL)
      const L = 300 - 200 * p;
      if (L >= 200) return 'polygon(0% 0%, 0% 0%, 0% 0%)';
      if (L <= 100) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
      return `polygon(100% 100%, 100% 0%, 0% 0%, 0% 100%, ${L - 100}% 100%, 100% ${L - 100}%)`;
    }
    default:
      return `inset(0 0 0 ${hidden}%)`;
  }
}

export function getCaptionTitle(cue: Cue | null | undefined): string {
  return cue?.captionTitle ?? cue?.analysis?.caption ?? '';
}
export function getCaptionSub(cue: Cue | null | undefined): string {
  return cue?.captionSub ?? '';
}
export function getCaptionTag(cue: Cue | null | undefined): string {
  return cue?.captionTag ?? (cue?.analysis?.mood ? cue.analysis.mood.toUpperCase() : 'FRAMEFLOW');
}

export function getCueHoldDuration(cue: Cue | null | undefined, defaultVal: number): number {
  return (cue?.holdDuration != null ? cue.holdDuration : defaultVal);
}
export function getCueFadeIn(cue: Cue | null | undefined, defaultVal: number): number {
  return (cue?.fadeIn != null ? cue.fadeIn : defaultVal);
}
export function getCueFadeOut(cue: Cue | null | undefined, defaultVal: number): number {
  return (cue?.fadeOut != null ? cue.fadeOut : defaultVal);
}
export function getCueEOC(cue: Cue | null | undefined, defaultVal: EndOfCue): EndOfCue {
  return (cue?.eoc as EndOfCue) ?? defaultVal;
}
export function getGroupEOC(group: Group | null | undefined, defaultVal: EndOfCue): EndOfCue {
  return (group?.eoc as EndOfCue) ?? defaultVal;
}
export function getGroupTransitionBetween(group: Group | null | undefined, defaultVal: BetweenImageTransition): BetweenImageTransition {
  return group?.transitionBetween ?? defaultVal;
}
/** Crossfade duration between images (0.5–2s). Used when transitionBetween is 'crossfade'. */
export function getGroupTransitionBetweenDuration(group: Group | null | undefined, defaultVal: number): number {
  const v = group?.transitionBetweenDuration;
  if (v == null) return defaultVal;
  return Math.max(0.5, Math.min(2, v));
}
export function getGroupFadeIn(group: Group | null | undefined, defaultVal: number): number {
  return group?.fadeIn != null ? Math.max(0, group.fadeIn) : defaultVal;
}
export function getGroupFadeOut(group: Group | null | undefined, defaultVal: number): number {
  return group?.fadeOut != null ? Math.max(0, group.fadeOut) : defaultVal;
}
export function getGroupFadeTo(group: Group | null | undefined, defaultVal: 'black' | 'transparent'): 'black' | 'transparent' {
  return (group?.fadeTo === 'transparent' ? 'transparent' : group?.fadeTo === 'black' ? 'black' : defaultVal) as 'black' | 'transparent';
}
export function getCueTransitionType(cue: Cue | null | undefined, defaultVal: TransitionType): TransitionType {
  return (cue?.transitionType as TransitionType) ?? defaultVal;
}
export function getCueTransDuration(cue: Cue | null | undefined, defaultVal: number): number {
  return (cue?.transDuration != null ? cue.transDuration : defaultVal);
}
export function getCueZoomScale(cue: Cue | null | undefined, defaultVal: number): number {
  return (cue?.zoomScale != null ? cue.zoomScale : defaultVal);
}
export function getCueMotionSpeed(cue: Cue | null | undefined, defaultVal: number): number {
  return (cue?.motionSpeed != null ? cue.motionSpeed : defaultVal);
}
export function getCueModeOpts(cue: Cue | null | undefined, defaultVal: ModeOpts): ModeOpts {
  return (cue?.modeOpts ? cue.modeOpts : defaultVal) as ModeOpts;
}
export function getCueCaptionStyle(cue: Cue | null | undefined, defaultVal: CaptionStyle): CaptionStyle {
  const base = defaultVal;
  const over = cue?.captionStyle;
  if (!over) return base;
  const pos = (over.position as string) === 'lower' ? 'bottom' : (over.position ?? base.position);
  return { ...base, ...over, position: pos, justify: over.justify ?? base.justify ?? 'left' };
}

export function getKBAnim(cue: Cue | null | undefined, globalKb: string): string {
  if (globalKb !== 'auto' && globalKb !== 'custom') return globalKb;
  return (cue?.kbAnim as string) ?? 'zoom-in';
}

export function getKBScaleVar(cue: Cue | null | undefined, zoomScale: number): number {
  const zs = getCueZoomScale(cue, zoomScale);
  return ZOOM_SCALE_VALUES[Math.max(0, Math.min(zs - 1, 4))] ?? 1.1;
}

/** For preset motions only: scale is at least PRESET_MIN_ZOOM so image stays filled and motion is visible. Custom uses getKBScaleVar as-is. */
export function getKBScaleVarForPreset(cue: Cue | null | undefined, zoomScale: number): number {
  return Math.max(getKBScaleVar(cue, zoomScale), PRESET_MIN_ZOOM);
}

export function getKBDuration(cue: Cue | null | undefined, holdDuration: number, motionSpeed: number): number {
  const hd = getCueHoldDuration(cue, holdDuration);
  const sp = getCueMotionSpeed(cue, motionSpeed);
  const mult = MOTION_SPEED_MULT[Math.max(0, Math.min(sp - 1, 4))] ?? 1;
  return Math.max(1, hd * mult);
}

export function getKBAnimationName(kbAnim: string): string {
  return KB_ANIM_MAP[kbAnim] ?? 'kb-zi';
}

/** Max scale for blur-frame presets so the image stays contained (no zooming into letterboxing). Frame is always 16:9 viewport; frameAspect = (frameWidthPct/frameHeightPct)*(16/9). */
export function getBlurContainMaxScale(frameAspect: number, imageAspect: number): number {
  if (!Number.isFinite(frameAspect) || !Number.isFinite(imageAspect) || imageAspect <= 0) return 10;
  return Math.max(frameAspect / imageAspect, imageAspect / frameAspect);
}

/** CSS transform: zoom to rectangle (fill viewport), correct X/Y so crop matches the box. */
export function getCustomKBTransform(pt: KbPoint, zoomScaleMult: number = 1): string {
  /* max = rectangle fills viewport (one axis fills, other may crop) — matches “framing width” from custom editor */
  const { cx, cy, z } = kbPointToXYZ(pt);
  return getCustomKBTransformFromXYZ(cx, cy, z, zoomScaleMult);
}

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

/** Image aspect (width/height). In 0-100 square space both axes are normalised. */
const DEFAULT_IMAGE_ASPECT = 16 / 9;

/** Convert rectangle to center+zoom; z from both axes (max of zFromW, zFromH) so zoom reflects tighter axis. */
export function kbPointToXYZ(
  pt: KbPoint,
  _imageAspect: number = DEFAULT_IMAGE_ASPECT
): { cx: number; cy: number; z: number } {
  const cx = pt.x + pt.w / 2;
  const cy = pt.y + pt.h / 2;
  const zFromW = 100 / Math.max(pt.w, 1);
  const zFromH = 100 / Math.max(pt.h, 1);
  const z = Math.max(1, Math.max(zFromW, zFromH));
  return { cx, cy, z };
}

/** Convert center+zoom to rectangle; in 0-100 normalised space visible size is 100/z on both axes (square). */
export function xyzToKbPoint(cx: number, cy: number, z: number): KbPoint {
  const size = Math.max(10, Math.min(100, 100 / Math.max(z, 0.1)));
  let x = cx - size / 2;
  let y = cy - size / 2;
  x = Math.max(0, Math.min(100 - size, x));
  y = Math.max(0, Math.min(100 - size, y));
  return { x, y, w: size, h: size };
}

/** Effective (cx, cy, z) for start: direct cue fields if set, else from rectangle. Uses imageAspect when set so non-16:9 images get correct zoom. */
export function getCueStartXYZ(cue: Cue): { cx: number; cy: number; z: number } | null {
  if (cue.kbStartCx != null && cue.kbStartCy != null && cue.kbStartZ != null)
    return { cx: cue.kbStartCx, cy: cue.kbStartCy, z: cue.kbStartZ };
  if (cue.kbCustomStart) {
    if (cue.imageAspect != null && Number.isFinite(cue.imageAspect) && cue.imageAspect > 0)
      return kbPointToXYZAspect(cue.kbCustomStart, cue.imageAspect);
    return kbPointToXYZ(cue.kbCustomStart);
  }
  return null;
}

/** Effective (cx, cy, z) for end: direct cue fields if set, else from rectangle. Uses imageAspect when set so non-16:9 images get correct zoom. */
export function getCueEndXYZ(cue: Cue): { cx: number; cy: number; z: number } | null {
  if (cue.kbEndCx != null && cue.kbEndCy != null && cue.kbEndZ != null)
    return { cx: cue.kbEndCx, cy: cue.kbEndCy, z: cue.kbEndZ };
  if (cue.kbCustomEnd) {
    if (cue.imageAspect != null && Number.isFinite(cue.imageAspect) && cue.imageAspect > 0)
      return kbPointToXYZAspect(cue.kbCustomEnd, cue.imageAspect);
    return kbPointToXYZ(cue.kbCustomEnd);
  }
  return null;
}

/** Given (cx, cy, z) and zoomScaleMult, return the visible crop rectangle in 0-100 space (for validation). */
export function getVisibleCropRect(
  cx: number,
  cy: number,
  z: number,
  zoomScaleMult: number = 1
): KbPoint {
  const effectiveZ = Math.max(0.5, Math.min(10, z * zoomScaleMult));
  const size = 100 / effectiveZ;
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}

/** For non-square coordinate space: Y compressed by imageAspect. */
export function kbPointToXYZAspect(
  pt: KbPoint,
  imageAspect: number
): { cx: number; cy: number; z: number } {
  const cx = pt.x + pt.w / 2;
  const cy = pt.y + pt.h / 2;
  const zFromW = 100 / Math.max(pt.w, 1);
  const zFromH = (100 / imageAspect) / Math.max(pt.h, 1);
  const z = Math.max(1, Math.max(zFromW, zFromH));
  return { cx, cy, z };
}

let customKbCounter = 0;
export function applyCustomKBKeyframes(
  kbEl: HTMLElement,
  start: KbPoint,
  end: KbPoint,
  dur: number,
  zoomScaleMult: number = 1
): void {
  const pt2css = (pt: KbPoint) => getCustomKBTransform(pt, zoomScaleMult);
  customKbCounter += 1;
  const name = `kbC${customKbCounter}`;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-kb-custom', '1');
  styleEl.textContent = `@keyframes ${name}{from{transform:${pt2css(start)}}to{transform:${pt2css(end)}}}`;
  document.head.appendChild(styleEl);
  const all = document.querySelectorAll('style[data-kb-custom]');
  if (all.length > 30) all[0].remove();
  kbEl.style.transformOrigin = '50% 50%';
  kbEl.style.animation = `${name} ${dur}s ease-in-out forwards`;
}

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
  kbEl.style.animation = `${name} ${dur}s ease-in-out forwards`;
}

export function ensureCueModeOpts(cue: Cue, modeOpts: ModeOpts): void {
  if (!cue.modeOpts) cue.modeOpts = JSON.parse(JSON.stringify(modeOpts));
}
export function ensureCueCaptionStyle(cue: Cue, captionStyle: CaptionStyle): void {
  if (!cue.captionStyle) cue.captionStyle = JSON.parse(JSON.stringify(captionStyle));
}
