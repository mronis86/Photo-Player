import type {
  Cue,
  PlayoutPayload,
  CaptionStyle,
  ModeOpts,
  EndOfCue,
  TransitionType,
  WipeDirection,
} from './types';
import { DEFAULT_MODE_OPTS, DEFAULT_CAPTION_STYLE } from './types';
import { getCueStartXYZ, getCueEndXYZ } from './controllerHelpers';

export interface PlayoutPayloadInputs {
  cue: Cue;
  selectedMode: Cue['mode'];
  captionStyle: CaptionStyle;
  holdDuration: number;
  transitionType: TransitionType;
  transDuration: number;
  fadeInDur: number;
  fadeOutDur: number;
  endOfCueBehavior: EndOfCue;
  zoomScale: number;
  motionSpeed: number;
  kbDirection: string;
  modeOpts: ModeOpts;
  aspect: string;
  fadeTo?: 'black' | 'transparent';
  /** When building for last image in a group, pass group's EOC here. */
  overrideEoc?: EndOfCue;
  /** Override transition duration (e.g. group crossfade duration). */
  overrideTransDuration?: number;
  /** When set, force this transition type (e.g. controller Take with fade/wipe). Prevents useCut from forcing 'cut'. */
  overrideTransitionType?: TransitionType;
  /** Override fade in (e.g. group fade in for first image). */
  overrideFadeIn?: number;
  /** Override fade out (e.g. group fade out for last image). */
  overrideFadeOut?: number;
  /** Override fade to (e.g. group EOC fade to black/transparent). */
  overrideFadeTo?: 'black' | 'transparent';
  /** When transition is 'dip', color to dip to (hex). Defaults to #000000. */
  dipColor?: string;
  /** When transition is 'wipe', direction of the wipe. */
  wipeDirection?: WipeDirection;
  /** Seconds this layer was already on as incoming crossfade; playout uses for EOC/progress after commit. */
  crossfadeLeadIn?: number;
  /** When true, playout skips buffer (group advance = use next image's transition immediately). */
  groupAdvance?: boolean;
}

function getCaptionTitle(cue: Cue): string {
  return cue.captionTitle ?? cue.analysis?.caption ?? '';
}

function getCaptionSub(cue: Cue): string {
  return cue.captionSub ?? '';
}

function getCaptionTag(cue: Cue): string {
  return cue.captionTag ?? (cue.analysis?.mood ? cue.analysis.mood.toUpperCase() : 'FRAMEFLOW');
}

function getCueFadeIn(cue: Cue, defaultVal: number): number {
  return cue.fadeIn != null ? cue.fadeIn : defaultVal;
}

function getCueFadeOut(cue: Cue, defaultVal: number): number {
  return cue.fadeOut != null ? cue.fadeOut : defaultVal;
}

function getCueEOC(cue: Cue, defaultVal: EndOfCue): EndOfCue {
  return (cue.eoc as EndOfCue) ?? defaultVal;
}

function getCueHoldDuration(cue: Cue, defaultVal: number): number {
  return cue.holdDuration != null ? cue.holdDuration : defaultVal;
}

function getCueTransitionType(cue: Cue, defaultVal: TransitionType): TransitionType {
  const t = (cue.transitionType as TransitionType | 'czoom') ?? defaultVal;
  return t === 'czoom' ? 'fade' : t;
}

function getCueTransDuration(cue: Cue, defaultVal: number): number {
  return cue.transDuration != null ? cue.transDuration : defaultVal;
}

function getCueDipColor(cue: Cue, defaultVal: string): string {
  return cue.dipColor ?? defaultVal;
}

function getCueWipeDirection(cue: Cue, defaultVal: WipeDirection): WipeDirection {
  return (cue.wipeDirection as WipeDirection) ?? defaultVal;
}

function getCueZoomScale(cue: Cue, defaultVal: number): number {
  return cue.zoomScale != null ? cue.zoomScale : defaultVal;
}

function getCueMotionSpeed(cue: Cue, defaultVal: number): number {
  return cue.motionSpeed != null ? cue.motionSpeed : defaultVal;
}

function getKBAnim(cue: Cue, globalKb: string): string {
  if (globalKb !== 'auto' && globalKb !== 'custom') return globalKb;
  return cue.kbAnim ?? 'zoom-in';
}

const ZOOM_SCALE_VALUES = [1, 1.05, 1.1, 1.18, 1.28] as const;
const PRESET_MIN_ZOOM = 1.12;

function getKBScaleVar(cue: Cue, zoomScale: number): number {
  const zs = getCueZoomScale(cue, zoomScale);
  return ZOOM_SCALE_VALUES[Math.max(0, Math.min(zs - 1, 4))] ?? 1.1;
}

function getKBScaleVarForPreset(cue: Cue, zoomScale: number): number {
  return Math.max(getKBScaleVar(cue, zoomScale), PRESET_MIN_ZOOM);
}

function getKBDuration(cue: Cue, holdDuration: number, motionSpeed: number): number {
  const hd = getCueHoldDuration(cue, holdDuration);
  const sp = getCueMotionSpeed(cue, motionSpeed);
  const multipliers = [1.5, 1.2, 1, 0.8, 0.6];
  const mult = multipliers[Math.max(0, Math.min(sp - 1, 4))] ?? 1;
  return Math.max(1, hd * mult);
}

export function buildPlayoutPayload(inputs: PlayoutPayloadInputs): PlayoutPayload {
  const {
    cue,
    selectedMode,
    captionStyle,
    holdDuration,
    transitionType,
    transDuration,
    fadeInDur,
    fadeOutDur,
    endOfCueBehavior,
    zoomScale,
    motionSpeed,
    kbDirection,
    modeOpts,
    aspect,
    fadeTo = 'black',
  } = inputs;

  const mode = cue.mode ?? selectedMode ?? 'fullscreen';
  const cs = cue.captionStyle ?? captionStyle ?? DEFAULT_CAPTION_STYLE;
  const mo = cue.modeOpts ?? modeOpts ?? DEFAULT_MODE_OPTS;
  const eoc = inputs.overrideEoc ?? getCueEOC(cue, endOfCueBehavior);
  const payloadFadeTo = inputs.overrideFadeTo ?? (eoc === 'fade' ? (cue.eocFadeTo ?? fadeTo) : fadeTo);

  const modeOptsPayload: Record<string, unknown> =
    mode === 'split'
      ? ({ ...(mo.split || {}), objectFit: mo.fullscreen?.objectFit ?? 'cover' } as Record<string, unknown>)
      : mode === 'blurbg'
        ? ({ ...DEFAULT_MODE_OPTS.blurbg, ...(mo.blurbg || {}) } as Record<string, unknown>)
        : ((mo as unknown as Record<string, unknown>)[mode] ?? {}) as Record<string, unknown>;

  const startXYZ = getCueStartXYZ(cue);
  const endXYZ = getCueEndXYZ(cue);
  const directXYZ = startXYZ && endXYZ
    ? { kbStartCx: startXYZ.cx, kbStartCy: startXYZ.cy, kbStartZ: startXYZ.z, kbEndCx: endXYZ.cx, kbEndCy: endXYZ.cy, kbEndZ: endXYZ.z }
    : {};

  const kbAnim = getKBAnim(cue, kbDirection ?? 'auto');
  const payloadFadeIn = inputs.overrideFadeIn ?? getCueFadeIn(cue, fadeInDur);
  const resolvedTransitionType = getCueTransitionType(cue, transitionType);
  // Hard cut only when explicitly 'cut', or when 'fade' with no fade-in. Override wins so controller can force fade/wipe.
  const useCut = inputs.overrideTransitionType != null && inputs.overrideTransitionType !== 'cut'
    ? false
    : resolvedTransitionType === 'cut' || (resolvedTransitionType === 'fade' && payloadFadeIn === 0);
  const payloadTransitionType = inputs.overrideTransitionType ?? (useCut ? 'cut' : resolvedTransitionType);
  const payloadTransDuration = useCut ? 0 : (inputs.overrideTransDuration ?? getCueTransDuration(cue, transDuration));
  const payloadDipColor = payloadTransitionType === 'dip' ? getCueDipColor(cue, inputs.dipColor ?? '#000000') : undefined;
  const payloadWipeDirection = payloadTransitionType === 'wipe' ? getCueWipeDirection(cue, inputs.wipeDirection ?? 'left') : undefined;
  return {
    type: 'play',
    src: cue.src,
    name: cue.name,
    mode,
    kbAnim,
    kbScale: kbAnim === 'custom' ? getKBScaleVar(cue, zoomScale) : getKBScaleVarForPreset(cue, zoomScale),
    kbDur: getKBDuration(cue, holdDuration, motionSpeed),
    kbCustomStart: cue.kbCustomStart ?? null,
    kbCustomEnd: cue.kbCustomEnd ?? null,
    ...directXYZ,
    captionTitle: getCaptionTitle(cue),
    captionSub: getCaptionSub(cue),
    captionTag: getCaptionTag(cue),
    captionStyle: cs,
    subject: cue.analysis?.subject ?? '',
    holdDuration: getCueHoldDuration(cue, holdDuration),
    captionOn: cs.position !== 'off',
    transitionType: payloadTransitionType,
    transDuration: payloadTransDuration,
    fadeIn: payloadFadeIn,
    fadeOut: inputs.overrideFadeOut ?? getCueFadeOut(cue, fadeOutDur),
    eoc,
    aspect,
    modeOpts: modeOptsPayload,
    fadeTo: payloadFadeTo,
    ...(payloadDipColor != null ? { dipColor: payloadDipColor } : {}),
    ...(payloadWipeDirection != null ? { wipeDirection: payloadWipeDirection } : {}),
    ...(inputs.crossfadeLeadIn != null ? { crossfadeLeadIn: inputs.crossfadeLeadIn } : {}),
    ...(inputs.groupAdvance ? { groupAdvance: true } : {}),
  };
}