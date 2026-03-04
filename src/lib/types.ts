// Cue: single image with optional overrides
export interface Cue {
  id: string;
  src: string;
  name: string;
  /** Custom label in the cue list; when set, shown instead of name (filename). */
  displayName?: string;
  groupId?: string;
  mode?: 'fullscreen' | 'blurbg' | 'split';
  captionTitle?: string;
  captionSub?: string;
  captionTag?: string;
  analysis?: Analysis;
  modeOpts?: ModeOpts;
  captionStyle?: CaptionStyle;
  kbAnim?: KbAnim;
  kbCustomStart?: KbPoint;
  kbCustomEnd?: KbPoint;
  /** When set, these are used for the transform (source of truth); otherwise derived from rectangles */
  kbStartCx?: number;
  kbStartCy?: number;
  kbStartZ?: number;
  kbEndCx?: number;
  kbEndCy?: number;
  kbEndZ?: number;
  holdDuration?: number;
  fadeIn?: number;
  fadeOut?: number;
  eoc?: EndOfCue;
  /** When eoc is 'fade', target for this cue's EOC fade (defaults to global fadeTo). */
  eocFadeTo?: 'black' | 'transparent';
  transitionType?: TransitionType;
  transDuration?: number;
  /** When transitionType is 'dip', color to dip to (hex e.g. #000000). Defaults to black. */
  dipColor?: string;
  /** When transitionType is 'wipe', direction of the wipe. */
  wipeDirection?: WipeDirection;
  zoomScale?: number;
  motionSpeed?: number;
}

export interface Analysis {
  subject?: string;
  caption?: string;
  mood?: string;
  composition?: string;
  hasFace?: boolean;
  recommendedMode?: Cue['mode'];
  recommendReason?: string;
  kbAnim?: string;
  kbAnimReason?: string;
  tags?: string[];
  /** 'huggingface' = caption from BLIP; 'fallback' = from image size only */
  source?: 'huggingface' | 'fallback';
  /** Shown when source is fallback so you can see why AI failed */
  debugMessage?: string;
}

/** Result from backend image-analysis API */
export interface AnalysisResult {
  analysis: Analysis;
  mode: Cue['mode'];
  kbAnim: KbAnim;
  /** When AI detects subject position, custom Ken Burns start (0–100) */
  kbCustomStart?: KbPoint;
  /** When AI detects subject position, custom Ken Burns end (0–100) */
  kbCustomEnd?: KbPoint;
}

export interface ModeOpts {
  fullscreen: { vignette: boolean; objectFit: 'cover' | 'contain' };
  blurbg: { blurAmount: number; bgBrightness: number };
  split: { splitImgWidth: number; splitImageSide: 'left' | 'right' | 'center'; splitCenterWidth: number; splitCenterHeight: number; splitTextAlign: 'left' | 'center' | 'right'; };
}

export interface CaptionStyle {
  textColor: string;
  accentColor: string;
  bgColor: string;
  bgOpacity: number;
  position: 'bottom' | 'off';
  /** Lower-third text alignment (fullscreen / blurbg only) */
  justify: 'left' | 'center' | 'right';
}

export type KbAnim =
  | 'auto'
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-right'
  | 'pan-left'
  | 'drift'
  | 'custom';

export interface KbPoint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BetweenImageTransition = 'cut' | 'crossfade';

export interface Group {
  id: string;
  name: string;
  cueIds: string[];
  collapsed?: boolean;
  /** End of cue when the group finishes (last image). */
  eoc?: EndOfCue;
  /** Transition between images inside the group. */
  transitionBetween?: BetweenImageTransition;
  /** When transitionBetween is 'crossfade', duration in seconds (0.5–2). */
  transitionBetweenDuration?: number;
  /** Optional fade in (s) for the first image in the group. */
  fadeIn?: number;
  /** Optional fade out (s) for the last image / EOC fade. */
  fadeOut?: number;
  /** When EOC is fade, fade to black or transparent. */
  fadeTo?: 'black' | 'transparent';
}

export type CueItem = { type: 'single'; id: string } | { type: 'group'; id: string };

export type EndOfCue = 'hold' | 'fade' | 'clear';
export type TransitionType = 'fade' | 'wipe' | 'dip' | 'cut';

export type WipeDirection = 'left' | 'right' | 'up' | 'down' | 'diagonal-tl-br' | 'diagonal-br-tl' | 'diagonal-tr-bl' | 'diagonal-bl-tr';

// Payload sent to playout (matches original buildPlayoutPayload)
export interface PlayoutPayload {
  type: 'play';
  [key: string]: unknown;
  src: string;
  name: string;
  mode: 'fullscreen' | 'blurbg' | 'split';
  kbAnim: string;
  kbScale: number;
  kbDur: number;
  kbCustomStart: KbPoint | null;
  kbCustomEnd: KbPoint | null;
  /** When set, playout uses these for custom keyframes (source of truth) */
  kbStartCx?: number;
  kbStartCy?: number;
  kbStartZ?: number;
  kbEndCx?: number;
  kbEndCy?: number;
  kbEndZ?: number;
  captionTitle: string;
  captionSub: string;
  captionTag: string;
  captionStyle: CaptionStyle;
  subject: string;
  holdDuration: number;
  captionOn: boolean;
  transitionType: TransitionType;
  transDuration: number;
  fadeIn: number;
  fadeOut: number;
  eoc: EndOfCue;
  aspect: string;
  modeOpts: Record<string, unknown>;
  /** Resolved image URL for playout (e.g. signed URL for cloud); when set, used instead of src */
  resolvedSrc?: string;
  /** Fade in/out style: black overlay vs content opacity (transparent) */
  fadeTo?: 'black' | 'transparent';
  /** When transitionType is 'dip', color to dip to (hex). */
  dipColor?: string;
  /** When transitionType is 'wipe', direction of the wipe. */
  wipeDirection?: WipeDirection;
  /** Seconds this layer was already on as incoming crossfade before commit; playout uses for EOC/progress */
  crossfadeLeadIn?: number;
}

export type FadeTo = 'black' | 'transparent';

export const DEFAULT_MODE_OPTS: ModeOpts = {
  fullscreen: { vignette: false, objectFit: 'cover' },
  blurbg: { blurAmount: 28, bgBrightness: 0.45 },
  split: { splitImgWidth: 55, splitImageSide: 'left', splitCenterWidth: 40, splitCenterHeight: 45, splitTextAlign: 'left' },
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  textColor: '#ffffff',
  accentColor: '#d4ff47',
  bgColor: '#000000',
  bgOpacity: 75,
  position: 'off',
  justify: 'left',
};
