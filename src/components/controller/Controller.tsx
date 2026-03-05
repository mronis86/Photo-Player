import { useState, useRef, useCallback, useEffect } from 'react';
import type { Cue, Section, KbPoint } from '../../lib/types';
import type { ModeOpts, CaptionStyle, EndOfCue, TransitionType, WipeDirection } from '../../lib/types';
import { sendToPlayout, sendPlayPayload, subscribeToPlayout, DISCONNECT_AFTER_MS, CONNECTED_CHECK_INTERVAL_MS } from '../../lib/playoutChannel';
import { buildPlayoutPayload } from '../../lib/buildPlayoutPayload';
import { DEFAULT_MODE_OPTS, DEFAULT_CAPTION_STYLE } from '../../lib/types';
import { getCueHoldDuration, getCueEOC, getCueFadeIn, getCueFadeOut, getCueModeOpts, getCueCaptionStyle, kbPointToXYZ, xyzToKbPoint, getCueStartXYZ, getCueEndXYZ, getKBScaleVar, getWipeClipPath, getCustomKBTransformFromXYZ } from '../../lib/controllerHelpers';
import { runImageAnalysis } from '../../lib/imageAnalysis';
import { listProjects, loadProject, saveProject, type ProjectRow } from '../../lib/projects';
import { uploadCueImage, getSignedUrl, deleteCueImage, listCueImages, isCloudStoredCue, type CloudCueFile } from '../../lib/storage';
import { useAuth } from '../../contexts/AuthContext';
import { MonitorLayer } from './MonitorLayer';
import { MediaImg } from './MediaImg';

/** Broadcast: 16:9 only */
const ASPECTS = ['16:9'] as const;
type Aspect = (typeof ASPECTS)[number];
type SectionKey = 'aiAnalysis' | 'playbackMode' | 'timing' | 'eoc' | 'motion' | 'transition' | 'caption';

const SECTION_KEYS: SectionKey[] = ['aiAnalysis', 'playbackMode', 'timing', 'eoc', 'motion', 'transition', 'caption'];
const SECTION_META: Record<SectionKey, { label: string; keywords: string[] }> = {
  aiAnalysis: { label: 'AI', keywords: ['ai', 'analysis', 'analyze', 'import', 'caption', 'mood', 'composition'] },
  playbackMode: { label: 'Mode', keywords: ['playback', 'mode', 'fullscreen', 'full', 'blur', 'split', 'editorial', 'frame'] },
  timing: { label: 'Timing', keywords: ['timing', 'hold', 'duration', 'fade', 'in', 'out', 'seconds'] },
  eoc: { label: 'EOC', keywords: ['end', 'eoc', 'cue', 'hold', 'fade', 'clear', 'group', 'crossfade', 'between'] },
  motion: { label: 'Motion', keywords: ['motion', 'ken burns', 'zoom', 'pan', 'drift', 'custom', 'keyframe'] },
  transition: { label: 'Transition', keywords: ['transition', 'cut', 'fade', 'wipe', 'dip', 'duration'] },
  caption: { label: 'Caption', keywords: ['caption', 'title', 'text', 'sub', 'tag', 'lower third'] },
};
function getSectionsMatchingQuery(query: string): SectionKey[] {
  const q = query.trim().toLowerCase();
  if (!q) return SECTION_KEYS;
  return SECTION_KEYS.filter((key) => {
    const { label, keywords } = SECTION_META[key];
    return label.toLowerCase().includes(q) || keywords.some((kw) => kw.includes(q) || q.includes(kw));
  });
}

const TRANS_TYPES: TransitionType[] = ['cut', 'fade', 'wipe', 'dip'];
/** Cardinal directions for wipe (used in UI for now). */
const WIPE_DIRECTIONS_CARDINAL: WipeDirection[] = ['left', 'right', 'up', 'down'];
const KB_OPTIONS = ['auto', 'zoom-in', 'zoom-out', 'pan-right', 'pan-left', 'drift', 'custom'] as const;

const KB_ASPECT = 16 / 9;
function kbPoint16x9(x: number, y: number, w: number): KbPoint {
  return { x, y, w, h: w / KB_ASPECT };
}
const DEFAULT_KB_START: KbPoint = kbPoint16x9(5, 10, 50);
const DEFAULT_KB_END: KbPoint = kbPoint16x9(40, 25, 45);
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function generateConnectionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Custom Ken Burns: sliders are source of truth; overlays are read-only
const X_MIN = 0; const X_MAX = 100;
const Y_MIN = 0; const Y_MAX = 100;
const Z_MIN = 1; const Z_MAX = 10; const Z_STEP = 0.05;

function applyXYZ(
  cues: Cue[],
  cueId: string,
  which: 'start' | 'end',
  cx: number,
  cy: number,
  z: number
): Cue[] {
  const pt = xyzToKbPoint(cx, cy, z);
  return cues.map((c) => {
    if (c.id !== cueId) return c;
    if (which === 'start') {
      return { ...c, kbCustomStart: pt, kbStartCx: cx, kbStartCy: cy, kbStartZ: z };
    }
    return { ...c, kbCustomEnd: pt, kbEndCx: cx, kbEndCy: cy, kbEndZ: z };
  });
}

interface AxisSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color: string;
  onChange: (v: number) => void;
}
function AxisSlider({ label, value, min, max, step, color, onChange }: AxisSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ width: 16, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#ccc', userSelect: 'none' }}>{label}</span>
      <div style={{ flex: 1, position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, background: color, borderRadius: 2, pointerEvents: 'none' }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: '100%', height: 4, appearance: 'none', background: 'rgba(255,255,255,0.15)', borderRadius: 2, cursor: 'pointer', accentColor: color }}
        />
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={label === 'Z' ? value.toFixed(2) : Math.round(value)}
        onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onChange(clamp(v, min, max)); }}
        style={{ width: 52, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4, color: '#fff', fontSize: 12, fontFamily: 'monospace', padding: '2px 5px', textAlign: 'right' }}
      />
    </div>
  );
}

interface ThumbnailOverlayProps {
  imageSrc: string;
  userId: string | null;
  startXYZ: { cx: number; cy: number; z: number } | null;
  endXYZ: { cx: number; cy: number; z: number } | null;
  kbScale: number;
  /** When set, show the image cropped to this frame (motion within crop box). When null, show full image with both boxes. */
  editingFrame: 'start' | 'end' | null;
}
/** Fixed "frame" in editorial: centered, fixed size — zoom/pan happens inside it so the frame never moves. */
const EDITORIAL_FRAME_INSET_PCT = 10;
function ThumbnailOverlay({ imageSrc, userId, startXYZ, endXYZ, kbScale, editingFrame }: ThumbnailOverlayProps) {
  function toRect(xyz: { cx: number; cy: number; z: number }) {
    const effectiveZ = clamp(xyz.z * kbScale, 0.5, 10);
    const size = 100 / effectiveZ;
    return {
      x: clamp(xyz.cx - size / 2, 0, 100 - size),
      y: clamp(xyz.cy - size / 2, 0, 100 - size),
      w: size,
      h: size,
    };
  }
  const startRect = startXYZ ? toRect(startXYZ) : null;
  const endRect = endXYZ ? toRect(endXYZ) : null;
  const xyz = editingFrame === 'start' ? startXYZ : editingFrame === 'end' ? endXYZ : null;
  const imageTransform = xyz ? getCustomKBTransformFromXYZ(xyz.cx, xyz.cy, xyz.z, kbScale) : undefined;

  const frameStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${EDITORIAL_FRAME_INSET_PCT}%`,
    top: `${EDITORIAL_FRAME_INSET_PCT}%`,
    width: `${100 - 2 * EDITORIAL_FRAME_INSET_PCT}%`,
    height: `${100 - 2 * EDITORIAL_FRAME_INSET_PCT}%`,
    overflow: 'hidden',
    borderRadius: 2,
  };

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden', borderRadius: 4 }}>
      {editingFrame != null && xyz ? (
        <>
          <div style={frameStyle}>
            <MediaImg
              src={imageSrc}
              userId={userId}
              alt=""
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transformOrigin: '50% 50%',
                transform: imageTransform,
              }}
            />
          </div>
          <div style={{ ...frameStyle, pointerEvents: 'none', border: `2px solid ${editingFrame === 'start' ? '#f5c518' : '#3b9eff'}`, boxSizing: 'border-box' }}>
            <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, fontWeight: 700, color: editingFrame === 'start' ? '#f5c518' : '#3b9eff', textShadow: '0 1px 3px #000', userSelect: 'none' }}>{editingFrame === 'start' ? 'START' : 'END'}</span>
          </div>
        </>
      ) : (
        <>
          <MediaImg
            src={imageSrc}
            userId={userId}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
          {startRect && (
            <div style={{ position: 'absolute', left: `${startRect.x}%`, top: `${startRect.y}%`, width: `${startRect.w}%`, height: `${startRect.h}%`, border: '2px solid #f5c518', boxSizing: 'border-box', pointerEvents: 'none' }}>
              <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, fontWeight: 700, color: '#f5c518', textShadow: '0 1px 3px #000', userSelect: 'none' }}>START</span>
            </div>
          )}
          {endRect && (
            <div style={{ position: 'absolute', left: `${endRect.x}%`, top: `${endRect.y}%`, width: `${endRect.w}%`, height: `${endRect.h}%`, border: '2px solid #3b9eff', boxSizing: 'border-box', pointerEvents: 'none' }}>
              <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, fontWeight: 700, color: '#3b9eff', textShadow: '0 1px 3px #000', userSelect: 'none' }}>END</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getCue(cues: Cue[], id: string): Cue | undefined {
  return cues.find((c) => c.id === id);
}

/** Label shown in the cue list: custom display name if set, otherwise filename (cue.name). */
function getCueListLabel(cue: Cue): string {
  return (cue.displayName?.trim() || cue.name) || 'Untitled';
}

/** Flat playback order: all cue ids in section order. */
function getFlatCueIds(sections: Section[]): string[] {
  return sections.flatMap((s) => s.cueIds);
}

export function Controller() {
  const { user, signOut } = useAuth();
  const [playoutConnected, setPlayoutConnected] = useState(false);
  const [connectionCode, _setConnectionCode] = useState(() => generateConnectionCode());
  const [isLive, setIsLive] = useState(false);
  const [aspect, _setAspect] = useState<Aspect>('16:9');
  const [pvwSplit, setPvwSplit] = useState(38);
  const [loopOn, setLoopOn] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    aiAnalysis: true,
    playbackMode: true,
    timing: false,
    eoc: false,
    motion: false,
    transition: false,
    caption: false,
  });
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');
  const settingsSectionRefs = useRef<Record<SectionKey, HTMLDivElement | null>>({} as Record<SectionKey, HTMLDivElement | null>);
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const [selectedMode, setSelectedMode] = useState<'fullscreen' | 'blurbg' | 'split'>('fullscreen');
  const [cues, setCues] = useState<Cue[]>([]);
  const [sections, setSections] = useState<Section[]>([{ id: `sec-${Date.now()}`, name: 'Main', cueIds: [] }]);
  const [programCueItemIdx, setProgramCueItemIdx] = useState(-1);
  /** Selected cue for preview/next. */
  const [previewCueId, setPreviewCueId] = useState<string | null>(null);
  const flatCueIds = getFlatCueIds(sections);
  const [holdDuration, setHoldDuration] = useState(8);
  const [fadeInDur, setFadeInDur] = useState(0);
  const [fadeOutDur, setFadeOutDur] = useState(0);
  const [endOfCueBehavior, setEndOfCueBehavior] = useState<EndOfCue>('hold');
  type FadeTo = 'black' | 'transparent';
  const [fadeTo, setFadeTo] = useState<FadeTo>('black');
  const [transitionType, setTransitionType] = useState<TransitionType>('fade');
  const [transDuration, setTransDuration] = useState(0.8);
  /** When transition is 'dip', color to dip to (hex). */
  const [dipColor, setDipColor] = useState('#000000');
  /** When transition is 'wipe', direction of the wipe. */
  const [wipeDirection, setWipeDirection] = useState<WipeDirection>('left');
  const [zoomScale, setZoomScale] = useState(1);
  const [motionSpeed, setMotionSpeed] = useState(3);
  const [kbDirection, setKbDirection] = useState<string>('auto');
  const [modeOpts, setModeOpts] = useState<ModeOpts>(() => ({ ...DEFAULT_MODE_OPTS }));
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(() => ({ ...DEFAULT_CAPTION_STYLE }));
  const [motionAdvOpen, setMotionAdvOpen] = useState(false);
  const [kbEditingFrame, setKbEditingFrame] = useState<'start' | 'end' | null>(null);
  const [pvwPlaying, setPvwPlaying] = useState(false);
  const [pvwPlayKey, setPvwPlayKey] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [analyzeOnImport, setAnalyzeOnImport] = useState(() => {
    try {
      const v = localStorage.getItem('frameflow-analyzeOnImport');
      return v === 'true';
    } catch { return false; }
  });
  type StoreImagesMode = 'local' | 'hybrid' | 'cloud';
  const [storeImagesMode, setStoreImagesMode] = useState<StoreImagesMode>(() => {
    try {
      const v = localStorage.getItem('frameflow-storeImagesMode') as StoreImagesMode | null;
      if (v === 'local' || v === 'hybrid' || v === 'cloud') return v;
      const legacy = localStorage.getItem('frameflow-storeImagesInCloud');
      return legacy === 'true' ? 'cloud' : 'local';
    } catch { return 'local'; }
  });
  const storeImagesInCloud = storeImagesMode === 'cloud';
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [deleteCueModal, setDeleteCueModal] = useState<{ cue: Cue } | null>(null);
  const [renameCueModal, setRenameCueModal] = useState<Cue | null>(null);
  const [renameCueInput, setRenameCueInput] = useState('');
  const [cloudBrowserOpen, setCloudBrowserOpen] = useState(false);
  const [cloudFiles, setCloudFiles] = useState<CloudCueFile[]>([]);
  const [cloudFilesLoading, setCloudFilesLoading] = useState(false);
  const [cloudSelected, setCloudSelected] = useState<Set<string>>(new Set());
  const [useAiAnalysis, setUseAiAnalysis] = useState(() => {
    try {
      const v = localStorage.getItem('frameflow-useAiAnalysis');
      return v !== 'false';
    } catch { return true; }
  });
  const [analyzingCueId, setAnalyzingCueId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState('Untitled');
  const [projectList, setProjectList] = useState<ProjectRow[]>([]);
  const [projectListOpen, setProjectListOpen] = useState(false);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState('0:00');
  const [timeRemain, setTimeRemain] = useState('—');
  const [programCrossfadeNextCue, setProgramCrossfadeNextCue] = useState<Cue | null>(null);
  const [programOutgoingCue, setProgramOutgoingCue] = useState<Cue | null>(null);
  const [programCrossfadeDuration, setProgramCrossfadeDuration] = useState(0.8);
  const [programCrossfadeOutOpacity, setProgramCrossfadeOutOpacity] = useState(1);
  const [programCrossfadeInOpacity, setProgramCrossfadeInOpacity] = useState(0);
  const programCrossfadeDurationRef = useRef(0.8);
  /** 'fade' | 'wipe' when we're doing a smooth transition; null for cut. */
  const [programTransitionKind, setProgramTransitionKind] = useState<'fade' | 'wipe' | null>(null);
  /** Wipe: 100 = incoming fully clipped (hidden), 0 = fully revealed. Animated 100→0 over duration. */
  const [programWipeRevealPct, setProgramWipeRevealPct] = useState(100);
  /** EOC fade on program monitor: when true we're fading program view to black or transparent. */
  const [programEocFadeActive, setProgramEocFadeActive] = useState(false);
  const [programEocFadeTo, setProgramEocFadeTo] = useState<'black' | 'transparent'>('black');
  const [programEocFadeDuration, setProgramEocFadeDuration] = useState(1);
  const [programEocFadeOverlayOpacity, setProgramEocFadeOverlayOpacity] = useState(0);
  const [programEocContentOpacity, setProgramEocContentOpacity] = useState(1);
  /** When doing a fade/wipe take, we defer updating program indices until the transition ends so layers don't remount and jump. */
  const pendingProgramTakeRef = useRef<{ itemIdx: number; imageIdx: number } | null>(null);
  const playoutWindowRef = useRef<Window | null>(null);
  const connectionCodeRef = useRef<string>('');
  const playoutLastSeenRef = useRef<number>(0);
  const dualMonitorsRef = useRef<HTMLDivElement | null>(null);
  const pvwSplitRef = useRef(pvwSplit);
  const playStartTimeRef = useRef(0);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const flatCueIdsRef = useRef(flatCueIds);
  const programCueItemIdxRef = useRef(programCueItemIdx);
  const loopOnRef = useRef(loopOn);
  /** When set, next previewCueId change should trigger an automatic take (used by jump-to-next). */
  const takeOnNextPreviewRef = useRef(false);
  const cuesRef = useRef(cues);
  const sectionsRef = useRef(sections);
  const settingsRef = useRef({ selectedMode, captionStyle, holdDuration, transitionType, transDuration, dipColor, wipeDirection, fadeInDur, fadeOutDur, endOfCueBehavior, fadeTo, zoomScale, motionSpeed, kbDirection, modeOpts, aspect });
  flatCueIdsRef.current = flatCueIds;
  programCueItemIdxRef.current = programCueItemIdx;
  loopOnRef.current = loopOn;
  cuesRef.current = cues;
  sectionsRef.current = sections;
  settingsRef.current = { selectedMode, captionStyle, holdDuration, transitionType, transDuration, dipColor, wipeDirection, fadeInDur, fadeOutDur, endOfCueBehavior, fadeTo, zoomScale, motionSpeed, kbDirection, modeOpts, aspect };
  pvwSplitRef.current = pvwSplit;

  // Program monitor: when programCrossfadeNextCue is set (fade or wipe), animate then commit
  useEffect(() => {
    if (!programCrossfadeNextCue) return;
    const kind = programTransitionKind;
    const durMs = programCrossfadeDurationRef.current * 1000;
    const START_DELAY_MS = 80;
    const COMMIT_EXTRA_MS = 150;

    const tStart = setTimeout(() => {
      if (kind === 'fade') {
        setProgramCrossfadeOutOpacity(0);
        setProgramCrossfadeInOpacity(1);
      }
      // Wipe: programWipeRevealPct is driven by rAF below
    }, START_DELAY_MS);

    let wipeStartTime: number | null = null;
    let rafId: number;
    let wipeStartTimeout: ReturnType<typeof setTimeout>;
    const animateWipe = (now: number) => {
      if (wipeStartTime == null) wipeStartTime = now;
      const elapsed = now - wipeStartTime;
      const pct = Math.max(0, 100 - (elapsed / durMs) * 100);
      setProgramWipeRevealPct(pct);
      if (pct > 0) rafId = requestAnimationFrame(animateWipe);
    };
    if (kind === 'wipe') {
      wipeStartTimeout = setTimeout(() => {
        rafId = requestAnimationFrame((now) => {
          wipeStartTime = now;
          setProgramWipeRevealPct(100);
          rafId = requestAnimationFrame(animateWipe);
        });
      }, START_DELAY_MS);
    }

    const tEnd = setTimeout(() => {
      const pending = pendingProgramTakeRef.current;
      if (pending != null) {
        setProgramCueItemIdx(pending.itemIdx);
        programCueItemIdxRef.current = pending.itemIdx;
        pendingProgramTakeRef.current = null;
      }
      setProgramCrossfadeNextCue(null);
      setProgramOutgoingCue(null);
      setProgramTransitionKind(null);
      setProgramCrossfadeOutOpacity(1);
      setProgramCrossfadeInOpacity(0);
      setProgramWipeRevealPct(100);
    }, durMs + COMMIT_EXTRA_MS);

    return () => {
      clearTimeout(tStart);
      clearTimeout(tEnd);
      if (kind === 'wipe') {
        clearTimeout(wipeStartTimeout);
        cancelAnimationFrame(rafId);
      }
    };
  }, [programCrossfadeNextCue, programTransitionKind]);

  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const scrollToSection = useCallback((key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: true }));
    requestAnimationFrame(() => {
      const el = settingsSectionRefs.current[key];
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const visibleSectionKeys = getSectionsMatchingQuery(settingsSearchQuery);

  useEffect(() => {
    if (!settingsSearchQuery.trim() || visibleSectionKeys.length === 0) return;
    setOpenSections((prev) => {
      const next = { ...prev };
      visibleSectionKeys.forEach((key) => { next[key] = true; });
      return next;
    });
  }, [settingsSearchQuery, visibleSectionKeys.join(',')]);

  useEffect(() => {
    return subscribeToPlayout((msg) => {
      if (msg.type === 'connect' && 'code' in msg && msg.code === connectionCodeRef.current) {
        playoutLastSeenRef.current = Date.now();
        setPlayoutConnected(true);
        sendToPlayout({ type: 'connectionAccepted' }, playoutWindowRef.current);
      }
      if (msg.type === 'heartbeat') {
        playoutLastSeenRef.current = Date.now();
      }
    });
  }, []);

  useEffect(() => {
    if (!playoutConnected) return;
    const id = setInterval(() => {
      if (Date.now() - playoutLastSeenRef.current > DISCONNECT_AFTER_MS) {
        setPlayoutConnected(false);
      }
    }, CONNECTED_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playoutConnected]);

  useEffect(() => {
    try {
      localStorage.setItem('frameflow-analyzeOnImport', String(analyzeOnImport));
    } catch { /* ignore */ }
  }, [analyzeOnImport]);

  useEffect(() => {
    try {
      localStorage.setItem('frameflow-useAiAnalysis', String(useAiAnalysis));
    } catch { /* ignore */ }
  }, [useAiAnalysis]);

  useEffect(() => {
    try {
      localStorage.setItem('frameflow-storeImagesMode', storeImagesMode);
    } catch { /* ignore */ }
  }, [storeImagesMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsModalOpen) setSettingsModalOpen(false);
      else if (deleteCueModal) setDeleteCueModal(null);
      else if (renameCueModal) setRenameCueModal(null);
      else if (cloudBrowserOpen) setCloudBrowserOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsModalOpen, deleteCueModal, renameCueModal, cloudBrowserOpen]);

  useEffect(() => {
    if (renameCueModal) setRenameCueInput(renameCueModal.displayName ?? renameCueModal.name);
  }, [renameCueModal]);

  useEffect(() => {
    const el = dualMonitorsRef.current;
    const splitter = el?.querySelector('.monitor-splitter');
    if (!el || !splitter) return;
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      const startPct = pvwSplitRef.current;
      splitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (ev: MouseEvent) => {
        const totalW = el.offsetWidth - 4;
        const delta = ((ev.clientX - e.clientX) / totalW) * 100;
        setPvwSplit(Math.min(70, Math.max(20, startPct + delta)));
      };
      const onUp = () => {
        splitter.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    splitter.addEventListener('mousedown', onDown as EventListener);
    return () => splitter.removeEventListener('mousedown', onDown as EventListener);
  }, []);

  const previewCue = previewCueId ? getCue(cues, previewCueId) : undefined;
  const programCueId = programCueItemIdx >= 0 ? flatCueIds[programCueItemIdx] : undefined;
  const programCue = programCueId ? getCue(cues, programCueId) : undefined;
  const programTotalDur = programCue ? getCueHoldDuration(programCue, holdDuration) : holdDuration;
  const pendingTake = pendingProgramTakeRef.current;
  const effectiveProgramItemIdx = programCrossfadeNextCue && pendingTake != null ? pendingTake.itemIdx : programCueItemIdx;
  const effectiveProgramCue = programCrossfadeNextCue ?? programCue;
  const effectivePreviewMode = previewCue?.mode ?? selectedMode;
  const effectivePreviewModeOpts = previewCue ? getCueModeOpts(previewCue, modeOpts) : modeOpts;
  const effectivePreviewCaptionStyle = previewCue ? getCueCaptionStyle(previewCue, captionStyle) : captionStyle;
  const effectiveProgramMode = programCue?.mode ?? selectedMode;
  const effectiveProgramModeOpts = programCue ? getCueModeOpts(programCue, modeOpts) : modeOpts;
  const effectiveProgramCaptionStyle = programCue ? getCueCaptionStyle(programCue, captionStyle) : captionStyle;
  const panelAppliesToCue = Boolean(previewCueId);
  const panelCanEditCue = Boolean(previewCueId);
  const panelMode = panelCanEditCue ? effectivePreviewMode : selectedMode;
  const panelModeOpts = panelCanEditCue ? effectivePreviewModeOpts : modeOpts;
  const panelCaptionStyle = panelCanEditCue ? effectivePreviewCaptionStyle : captionStyle;
  const setPanelMode = useCallback((mode: 'fullscreen' | 'blurbg' | 'split') => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, mode } : c)));
    else setSelectedMode(mode);
  }, [previewCueId]);
  const setPanelModeOpts = useCallback((update: (prev: ModeOpts) => ModeOpts) => {
    if (previewCueId) {
      setCues((prev) => prev.map((c) => {
        if (c.id !== previewCueId) return c;
        const defaults = { splitImgWidth: 55, splitImageSide: 'left' as const, splitCenterWidth: 40, splitCenterHeight: 45, splitTextAlign: 'left' as const };
        const splitBase = { ...defaults, ...(c.modeOpts?.split ?? modeOpts.split) };
        const base = c.modeOpts
          ? { ...c.modeOpts, fullscreen: { ...c.modeOpts.fullscreen }, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...c.modeOpts.blurbg }, split: splitBase }
          : { ...modeOpts, fullscreen: { ...modeOpts.fullscreen }, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...modeOpts.blurbg }, split: splitBase };
        return { ...c, modeOpts: update(base) };
      }));
    } else setModeOpts(update);
  }, [previewCueId, modeOpts]);
  const setPanelCaptionStyle = useCallback((update: (prev: CaptionStyle) => CaptionStyle) => {
    if (previewCueId) {
      setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, captionStyle: update(c.captionStyle ? { ...c.captionStyle } : { ...captionStyle }) } : c)));
    } else setCaptionStyle(update);
  }, [previewCueId, captionStyle]);
  const panelHoldDuration = panelCanEditCue && previewCue ? getCueHoldDuration(previewCue, holdDuration) : holdDuration;
  const panelFadeInDur = panelCanEditCue && previewCue ? (previewCue.fadeIn != null ? previewCue.fadeIn : fadeInDur) : fadeInDur;
  const panelFadeOutDur = panelCanEditCue && previewCue ? (previewCue.fadeOut != null ? previewCue.fadeOut : fadeOutDur) : fadeOutDur;
  const panelEndOfCueBehavior = panelCanEditCue && previewCue ? ((previewCue.eoc as EndOfCue) ?? endOfCueBehavior) : endOfCueBehavior;
  const panelZoomScale = panelCanEditCue && previewCue ? (previewCue.zoomScale != null ? previewCue.zoomScale : zoomScale) : zoomScale;
  const panelMotionSpeed = panelCanEditCue && previewCue ? (previewCue.motionSpeed != null ? previewCue.motionSpeed : motionSpeed) : motionSpeed;
  const panelKbDirection = panelCanEditCue && previewCue ? (previewCue.kbAnim ?? kbDirection) : kbDirection;
  const panelTransitionTypeRaw = panelCanEditCue && previewCue ? ((previewCue.transitionType as TransitionType | 'czoom') ?? transitionType) : transitionType;
  const panelTransitionType: TransitionType = panelTransitionTypeRaw === 'czoom' ? 'fade' : panelTransitionTypeRaw;
  const panelTransDuration = panelCanEditCue && previewCue ? (previewCue.transDuration != null ? previewCue.transDuration : transDuration) : transDuration;
  const panelDipColor = panelCanEditCue && previewCue ? (previewCue.dipColor ?? dipColor) : dipColor;
  const panelWipeDirection = panelCanEditCue && previewCue ? ((previewCue.wipeDirection as WipeDirection) ?? wipeDirection) : wipeDirection;
  const setPanelHoldDuration = useCallback((v: number) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, holdDuration: v } : c)));
    else setHoldDuration(v);
  }, [previewCueId]);
  const setPanelFadeInDur = useCallback((v: number) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, fadeIn: v } : c)));
    else setFadeInDur(v);
  }, [previewCueId]);
  const setPanelFadeOutDur = useCallback((v: number) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, fadeOut: v } : c)));
    else setFadeOutDur(v);
  }, [previewCueId]);
  const setPanelEndOfCueBehavior = useCallback((v: EndOfCue) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, eoc: v } : c)));
    else setEndOfCueBehavior(v);
  }, [previewCueId]);
  const setPanelZoomScale = useCallback((v: number) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, zoomScale: v } : c)));
    else setZoomScale(v);
  }, [previewCueId]);
  const setPanelMotionSpeed = useCallback((v: number) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, motionSpeed: v } : c)));
    else setMotionSpeed(v);
  }, [previewCueId]);
  const setPanelKbDirection = useCallback((v: string) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, kbAnim: v as Cue['kbAnim'] } : c)));
    else setKbDirection(v);
  }, [previewCueId]);
  const setPanelTransitionType = useCallback((v: TransitionType) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, transitionType: v } : c)));
    else setTransitionType(v);
  }, [previewCueId]);
  const setPanelTransDuration = useCallback((v: number) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, transDuration: v } : c)));
    else setTransDuration(v);
  }, [previewCueId]);
  const setPanelDipColor = useCallback((v: string) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, dipColor: v } : c)));
    else setDipColor(v);
  }, [previewCueId]);
  const setPanelWipeDirection = useCallback((v: WipeDirection) => {
    if (previewCueId) setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, wipeDirection: v } : c)));
    else setWipeDirection(v);
  }, [previewCueId]);

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

  useEffect(() => {
    if (!isLive || !programCue) return;
    playStartTimeRef.current = Date.now();
    setProgressPct(0);
    const totalDur = getCueHoldDuration(programCue, holdDuration);
    const fadeInSec = getCueFadeIn(programCue, fadeInDur);
    const fmt = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${String(sec).padStart(2, '0')}`;
    };
    let raf: number;
    const tick = () => {
      const elapsed = (Date.now() - playStartTimeRef.current) / 1000;
      const effectiveElapsed = Math.max(0, elapsed - fadeInSec);
      const pct = Math.min((effectiveElapsed / totalDur) * 100, 100);
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      setProgressPct(pct);
      setTimeElapsed(fmt(effectiveElapsed));
      setTimeRemain(fmt(Math.max(0, totalDur - effectiveElapsed)));

      if (pct < 100) raf = requestAnimationFrame(tick);
      else {
        const ids = flatCueIdsRef.current;
        const idx = programCueItemIdxRef.current;
        if (programCue?.jumpToNext && idx >= 0 && idx < ids.length - 1) {
          takeOnNextPreviewRef.current = true;
          setPreviewCueId(ids[idx + 1]);
          return;
        }
        const eoc = getCueEOC(programCue, endOfCueBehavior);
        const fadeOut = getCueFadeOut(programCue, fadeOutDur);
        const effectiveFadeOut = eoc === 'fade' ? Math.max(fadeOut, 1) : fadeOut;
        if (eoc === 'fade') {
          const st = settingsRef.current;
          const eocFadeTo = (programCue.eocFadeTo ?? st.fadeTo) as 'black' | 'transparent';
          sendToPlayout({ type: 'fadeOut', duration: effectiveFadeOut, fadeTo: eocFadeTo }, playoutWindowRef.current);
          setProgramEocFadeOverlayOpacity(0);
          setProgramEocContentOpacity(1);
          setProgramEocFadeActive(true);
          setProgramEocFadeTo(eocFadeTo);
          setProgramEocFadeDuration(effectiveFadeOut);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (eocFadeTo === 'black') setProgramEocFadeOverlayOpacity(1);
              else setProgramEocContentOpacity(0);
            });
          });
          setTimeout(() => {
            setProgramEocFadeActive(false);
            setProgramEocFadeOverlayOpacity(0);
            setProgramEocContentOpacity(1);
            const idsNext = flatCueIdsRef.current;
            const idxNext = programCueItemIdxRef.current;
            const loop = loopOnRef.current;
            const st = settingsRef.current;
            if (loop && idsNext.length > 0) {
              const nextIdx = idxNext >= idsNext.length - 1 ? 0 : idxNext + 1;
              const nextCueId = idsNext[nextIdx];
              const nextCue = nextCueId ? getCue(cuesRef.current, nextCueId) : undefined;
              setProgramCueItemIdx(nextIdx);
              if (nextCue) {
                const payload = buildPlayoutPayload({
                  cue: nextCue,
                  selectedMode: st.selectedMode,
                  captionStyle: st.captionStyle,
                  holdDuration: st.holdDuration,
                  transitionType: 'cut',
                  transDuration: st.transDuration,
                  dipColor: st.dipColor,
                  wipeDirection: st.wipeDirection,
                  fadeInDur: st.fadeInDur,
                  fadeOutDur: st.fadeOutDur,
                  endOfCueBehavior: st.endOfCueBehavior,
                  zoomScale: st.zoomScale,
                  motionSpeed: st.motionSpeed,
                  kbDirection: st.kbDirection,
                  modeOpts: st.modeOpts,
                  aspect: st.aspect,
                  fadeTo: st.fadeTo,
                });
                void sendPlayPayload(payload, playoutWindowRef.current, user?.id ?? null);
                playStartTimeRef.current = Date.now();
              }
            } else {
              setIsLive(false);
              sendToPlayout({ type: 'stop' }, playoutWindowRef.current);
            }
          }, effectiveFadeOut * 1000);
        } else if (eoc === 'clear') {
          const idsNext = flatCueIdsRef.current;
          const idxNext = programCueItemIdxRef.current;
          const loop = loopOnRef.current;
          const st = settingsRef.current;
          if (loop && idsNext.length > 0) {
            const nextIdx = idxNext >= idsNext.length - 1 ? 0 : idxNext + 1;
            const nextCueId = idsNext[nextIdx];
            const nextCue = nextCueId ? getCue(cuesRef.current, nextCueId) : undefined;
            setProgramCueItemIdx(nextIdx);
            if (nextCue) {
              const payload = buildPlayoutPayload({
                cue: nextCue,
                selectedMode: st.selectedMode,
                captionStyle: st.captionStyle,
                holdDuration: st.holdDuration,
                transitionType: 'cut',
                transDuration: st.transDuration,
                dipColor: st.dipColor,
                wipeDirection: st.wipeDirection,
                fadeInDur: st.fadeInDur,
                fadeOutDur: st.fadeOutDur,
                endOfCueBehavior: st.endOfCueBehavior,
                zoomScale: st.zoomScale,
                motionSpeed: st.motionSpeed,
                kbDirection: st.kbDirection,
                modeOpts: st.modeOpts,
                aspect: st.aspect,
                fadeTo: st.fadeTo,
              });
              void sendPlayPayload(payload, playoutWindowRef.current, user?.id ?? null);
              playStartTimeRef.current = Date.now();
            }
          } else {
            setIsLive(false);
            sendToPlayout({ type: 'stop' }, playoutWindowRef.current);
          }
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isLive, programCueItemIdx, holdDuration, endOfCueBehavior, fadeOutDur, flatCueIds, user?.id, fadeInDur]);

  const handlePvwPlay = () => {
    if (!previewCue) return;
    if (pvwPlaying) {
      setPvwPlaying(false);
      return;
    }
    setPvwPlayKey((k) => k + 1);
    setPvwPlaying(true);
    const durMs = getCueHoldDuration(previewCue, holdDuration) * 1000;
    setTimeout(() => setPvwPlaying(false), durMs);
  };

  useEffect(() => {
    connectionCodeRef.current = connectionCode;
  }, [connectionCode]);

  const handleOpenPlayout = () => {
    if (playoutWindowRef.current && !playoutWindowRef.current.closed) {
      playoutWindowRef.current.focus();
      return;
    }
    playoutWindowRef.current = window.open('/playout.html', 'frameflow_playout', 'width=1280,height=720,resizable=yes');
    setTimeout(() => sendToPlayout({ type: 'init', aspect }, playoutWindowRef.current), 800);
  };

  const handleTakeToProgram = useCallback(() => {
    if (!previewCueId || !previewCue || !flatCueIds.length) return;
    const idx = flatCueIds.indexOf(previewCueId);
    const transType = (previewCue.transitionType as TransitionType) ?? transitionType;
    const transDur = previewCue.transDuration != null ? previewCue.transDuration : transDuration;
    const useSmoothTransition = (transType === 'fade' || transType === 'wipe') && transDur > 0 && isLive && programCue != null;

    if (useSmoothTransition) {
      pendingProgramTakeRef.current = { itemIdx: idx >= 0 ? idx : 0, imageIdx: 0 };
    } else {
      setProgramCueItemIdx(idx >= 0 ? idx : 0);
    }
    setIsLive(true);

    if (useSmoothTransition) {
      setProgramOutgoingCue(programCue);
      setProgramCrossfadeNextCue(previewCue);
      setProgramTransitionKind(transType === 'wipe' ? 'wipe' : 'fade');
      if (transType === 'wipe') setProgramWipeRevealPct(100);
      programCrossfadeDurationRef.current = transDur;
      setProgramCrossfadeDuration(transDur);
      setProgramCrossfadeOutOpacity(1);
      setProgramCrossfadeInOpacity(0);
    } else {
      setProgramCrossfadeNextCue(null);
      setProgramOutgoingCue(null);
      setProgramTransitionKind(null);
    }

    const payload = buildPlayoutPayload({
      cue: previewCue,
      selectedMode: selectedMode,
      captionStyle,
      holdDuration,
      transitionType: useSmoothTransition ? transType : 'cut',
      transDuration: useSmoothTransition ? transDur : transDuration,
      dipColor,
      fadeInDur,
      fadeOutDur,
      endOfCueBehavior,
      fadeTo,
      zoomScale,
      motionSpeed,
      kbDirection,
      modeOpts,
      aspect,
      ...(useSmoothTransition ? { overrideTransitionType: transType, overrideTransDuration: transDur } : {}),
    });
    void sendPlayPayload(payload, playoutWindowRef.current, user?.id ?? null);
  }, [previewCueId, previewCue, cues, flatCueIds, selectedMode, captionStyle, holdDuration, transitionType, transDuration, dipColor, wipeDirection, fadeInDur, fadeOutDur, endOfCueBehavior, fadeTo, zoomScale, motionSpeed, kbDirection, modeOpts, aspect, user?.id, isLive, programCue]);

  // When jump-to-next sets preview then this flag, take the new preview to program
  useEffect(() => {
    if (!takeOnNextPreviewRef.current || !previewCueId) return;
    takeOnNextPreviewRef.current = false;
    handleTakeToProgram();
  }, [previewCueId, handleTakeToProgram]);

  const handleSelectPrevNext = useCallback((direction: -1 | 1) => {
    const total = flatCueIds.length;
    if (total === 0) return;
    const idx = previewCueId == null ? -1 : flatCueIds.indexOf(previewCueId);
    let nextIdx: number;
    if (idx < 0) {
      nextIdx = direction === 1 ? 0 : total - 1;
    } else {
      nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= total) return;
    }
    setPreviewCueId(flatCueIds[nextIdx]);
  }, [previewCueId, flatCueIds]);

  const moveCueInSection = useCallback((sectionId: string, cueId: string, direction: -1 | 1) => {
    setSections((prev) => prev.map((s) => {
      if (s.id !== sectionId) return s;
      const i = s.cueIds.indexOf(cueId);
      if (i < 0) return s;
      const j = i + direction;
      if (j < 0 || j >= s.cueIds.length) return s;
      const next = [...s.cueIds];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...s, cueIds: next };
    }));
  }, []);

  const moveSection = useCallback((sectionIdx: number, direction: -1 | 1) => {
    const j = sectionIdx + direction;
    if (j < 0 || j >= sections.length) return;
    setSections((prev) => {
      const next = [...prev];
      [next[sectionIdx], next[j]] = [next[j], next[sectionIdx]];
      return next;
    });
  }, [sections.length]);

  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s)));
  }, []);

  const removeSection = useCallback((sectionId: string) => {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;
    if (sec.cueIds.length > 0 && !window.confirm(`Move ${sec.cueIds.length} item(s) to first section and remove "${sec.name}"?`)) return;
    setSections((prev) => {
      const rest = prev.filter((s) => s.id !== sectionId);
      const first = rest[0];
      if (sec.cueIds.length > 0 && first) {
        return rest.map((s) => (s.id === first.id ? { ...s, cueIds: [...s.cueIds, ...sec.cueIds] } : s));
      }
      return rest;
    });
  }, [sections]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inInput = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t.getAttribute?.('contenteditable') === 'true');
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        if (inInput) return;
        e.preventDefault();
        handleSelectPrevNext(e.code === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.code === 'Space' && !e.repeat && !inInput) {
        e.preventDefault();
        handleTakeToProgram();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleTakeToProgram, handleSelectPrevNext]);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>, targetSectionId?: string) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.target.value = '';
    const sectionId = targetSectionId ?? sections[0]?.id;

    const useCloud = storeImagesInCloud && user?.id;

    if (useCloud) {
      for (const file of imgs) {
        const name = file.name.replace(/\.[^.]+$/, '');
        const id = `cue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        try {
          const path = await uploadCueImage(file, user.id, id);
          const cue: Cue = { id, src: path, name };
          setCues((prev) => [...prev, cue]);
          if (sectionId) {
            setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, cueIds: [...s.cueIds, id] } : s)));
          }
          setPreviewCueId(id);
          if (analyzeOnImport) {
            setAnalyzingCueId(id);
            const signedUrl = await getSignedUrl(user.id, path);
            runImageAnalysis(signedUrl, name, useAiAnalysis)
              .then((result) => {
                const { analysis, mode, kbAnim, kbCustomStart, kbCustomEnd } = result;
                setCues((prev) =>
                  prev.map((c) =>
                    c.id === id
                      ? { ...c, analysis, mode, kbAnim, kbCustomStart, kbCustomEnd }
                      : c
                  )
                );
              })
              .catch(() => { /* leave cue without analysis on error */ })
              .finally(() => setAnalyzingCueId(null));
          }
        } catch (err) {
          setProjectSaveError(err instanceof Error ? err.message : 'Upload failed');
        }
      }
      return;
    }

    imgs.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = (ev.target?.result as string) ?? '';
        const name = file.name.replace(/\.[^.]+$/, '');
        const id = `cue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const cue: Cue = { id, src, name };
        setCues((prev) => [...prev, cue]);
        if (sectionId) {
          setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, cueIds: [...s.cueIds, id] } : s)));
        }
        setPreviewCueId(id);
        if (analyzeOnImport) {
          setAnalyzingCueId(id);
          runImageAnalysis(src, name, useAiAnalysis)
            .then((result) => {
              const { analysis, mode, kbAnim, kbCustomStart, kbCustomEnd } = result;
              setCues((prev) =>
                prev.map((c) =>
                  c.id === id
                    ? { ...c, analysis, mode, kbAnim, kbCustomStart, kbCustomEnd }
                    : c
                )
              );
            })
            .catch(() => { /* leave cue without analysis on error */ })
            .finally(() => setAnalyzingCueId(null));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const addSection = () => {
    const name = window.prompt('Section name:', `Section ${sections.length + 1}`) || `Section ${sections.length + 1}`;
    const id = `sec-${Date.now()}`;
    setSections((prev) => [...prev, { id, name, cueIds: [] }]);
  };

  const clearCues = () => {
    if (!window.confirm('Clear all cues?')) return;
    setCues([]);
    setSections([{ id: `sec-${Date.now()}`, name: 'Main', cueIds: [] }]);
    setProgramCueItemIdx(-1);
    setPreviewCueId(null);
    setIsLive(false);
  };

  const handleRemoveCue = (alsoDeleteFromCloud: boolean) => {
    if (!deleteCueModal) return;
    const { cue } = deleteCueModal;
    const isCloud = isCloudStoredCue(cue.src);
    if (isCloud && alsoDeleteFromCloud && user?.id) {
      deleteCueImage(user.id, cue.src).catch((e) => setProjectSaveError(e instanceof Error ? e.message : 'Failed to delete from cloud'));
    }
    setCues((p) => p.filter((c) => c.id !== cue.id));
    setSections((p) => p.map((s) => ({ ...s, cueIds: s.cueIds.filter((id) => id !== cue.id) })));
    if (previewCueId === cue.id) setPreviewCueId(null);
    setDeleteCueModal(null);
  };

  const handleOpenCloudBrowser = () => {
    if (!user?.id) return;
    setCloudBrowserOpen(true);
    setCloudFilesLoading(true);
    setCloudSelected(new Set());
    listCueImages(user.id)
      .then(setCloudFiles)
      .catch((e) => setProjectSaveError(e instanceof Error ? e.message : 'Failed to list cloud images'))
      .finally(() => setCloudFilesLoading(false));
  };

  const handleAddFromCloud = () => {
    if (!user?.id || cloudSelected.size === 0) return;
    const toAdd = cloudFiles.filter((f) => cloudSelected.has(f.path));
    const newCues: Cue[] = toAdd.map((file, i) => {
      const id = `cue-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`;
      return { id, src: file.path, name: file.name, groupId: undefined };
    });
    setCues((prev) => [...prev, ...newCues]);
    const firstSectionId = sections[0]?.id;
    if (firstSectionId) {
      setSections((prev) => prev.map((s) => (s.id === firstSectionId ? { ...s, cueIds: [...s.cueIds, ...newCues.map((c) => c.id)] } : s)));
    }
    if (newCues.length > 0) setPreviewCueId(newCues[newCues.length - 1].id);
    setCloudSelected(new Set());
    setCloudBrowserOpen(false);
  };

  const toggleCloudSelected = (path: string) => {
    setCloudSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleNewProject = () => {
    setCurrentProjectId(null);
    setCurrentProjectName('Untitled');
    setCues([]);
    setSections([{ id: `sec-${Date.now()}`, name: 'Main', cueIds: [] }]);
    setProgramCueItemIdx(-1);
    setPreviewCueId(null);
    setProjectSaveError(null);
  };

  const handleSaveProject = async () => {
    setProjectSaveError(null);
    try {
      const id = await saveProject(currentProjectId, currentProjectName, { cues, sections });
      setCurrentProjectId(id);
    } catch (e) {
      setProjectSaveError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const handleOpenProjectList = async () => {
    if (projectListOpen) {
      setProjectListOpen(false);
      return;
    }
    try {
      const list = await listProjects();
      setProjectList(list);
      setProjectListOpen(true);
    } catch (e) {
      setProjectSaveError(e instanceof Error ? e.message : 'Load list failed');
    }
  };

  const handleLoadProject = async (id: string) => {
    setProjectListOpen(false);
    setProjectSaveError(null);
    try {
      const payload = await loadProject(id);
      setCues(payload.cues);
      setSections(payload.sections);
      setCurrentProjectId(id);
      setCurrentProjectName(projectList.find((p) => p.id === id)?.name ?? 'Untitled');
      setProgramCueItemIdx(-1);
      const firstId = getFlatCueIds(payload.sections)[0] ?? null;
      setPreviewCueId(firstId);
    } catch (e) {
      setProjectSaveError(e instanceof Error ? e.message : 'Load failed');
    }
  };

  const totalItems = flatCueIds.length;
  const programCueNum = programCueItemIdx >= 0 ? String(programCueItemIdx + 1).padStart(2, '0') : '—';
  const previewCueItemIdx = previewCueId != null ? flatCueIds.indexOf(previewCueId) : -1;
  const nextCueNum = previewCueItemIdx >= 0 ? String(previewCueItemIdx + 1).padStart(2, '0') : '—';

  return (
    <>
      <header>
        <div className="logo">FRAMEFLOW</div>
        <div className="logo-sub">VISUAL PLAYBACK</div>
        <div className="divider" />
        <div className={`badge ${isLive ? 'badge-live' : 'badge-idle'}`}>
          <div className={`dot ${isLive ? 'dot-red' : 'dot-grey'}`} />
          {isLive ? ' ON AIR' : ' IDLE'}
        </div>
        <div className="header-right">
          <span
            style={{
              fontFamily: "'DM Mono'",
              fontSize: 10,
              color: playoutConnected ? 'var(--green)' : 'var(--text3)',
              letterSpacing: 1,
            }}
          >
            {playoutConnected ? '● PLAYOUT CONNECTED' : `Code: ${connectionCode} — enter on playout`}
          </span>
          <div className="divider" />
          <button type="button" className="btn-playout" onClick={handleOpenPlayout}>
            ⬛ OPEN PLAYOUT
          </button>
          <div className="divider" />
          <span className="header-user-badge" title={user?.email ?? ''}>
            {user?.email ?? 'User'}
          </span>
          <button type="button" className="btn-sm" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="main">
        {/* LEFT: CUE LIST */}
        <div className="panel panel-left">
          <div className="sec">
            <div className="sec-label">Projects</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              <button type="button" className="btn-sm" onClick={handleNewProject}>
                New
              </button>
              <button type="button" className="btn-sm" onClick={handleSaveProject}>
                Save
              </button>
              <button
                type="button"
                className="btn-sm"
                onClick={handleOpenProjectList}
                aria-expanded={projectListOpen}
              >
                Open
              </button>
              <button
                type="button"
                className="btn-sm"
                onClick={() => setSettingsModalOpen(true)}
                title="Settings"
              >
                ⚙ Settings
              </button>
            </div>
            <div style={{ marginBottom: 4 }}>
              <input
                type="text"
                value={currentProjectName}
                onChange={(e) => setCurrentProjectName(e.target.value)}
                placeholder="Untitled"
                className="project-name-input"
                title="Project name"
              />
            </div>
            {projectListOpen && projectList.length > 0 && (
              <ul className="project-list">
                {projectList.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="project-list-btn" onClick={() => handleLoadProject(p.id)}>
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {projectSaveError && (
              <p style={{ fontSize: 10, color: 'var(--red)', marginTop: 6 }}>{projectSaveError}</p>
            )}
          </div>
          <div className="sec">
            <div className="sec-label">
              Load Media
              <span style={{ display: 'flex', gap: 5 }}>
                <button
                  type="button"
                  className="cue-act-btn"
                  style={{ opacity: 1, padding: '2px 8px', fontSize: 8 }}
                  onClick={addSection}
                >
                  + Group
                </button>
                <button type="button" className="cue-act-btn" style={{ opacity: 1, color: 'var(--text3)' }} onClick={clearCues}>
                  Clear
                </button>
              </span>
            </div>
            <div
              className="upload-zone"
              onClick={() => document.getElementById('fileInput')?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
              onDragLeave={(e) => e.currentTarget.classList.remove('drag')}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag');
                const files = Array.from(e.dataTransfer.files);
                if (files.length) {
                  const input = document.getElementById('fileInput') as HTMLInputElement;
                  if (input) {
                    const dt = new DataTransfer();
                    files.forEach((f) => dt.items.add(f));
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
              }}
            >
              <input
                type="file"
                id="fileInput"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleFileInput(e)}
              />
              <div style={{ fontSize: 16, marginBottom: 3 }}>⬆</div>
              <p>
                <strong>Drop images here</strong> or click to browse
              </p>
              <p>Drop or click to add to cue list</p>
            </div>
            {(user && (storeImagesMode === 'cloud' || storeImagesMode === 'hybrid')) && (
              <button
                type="button"
                className="btn-sm"
                style={{ marginTop: 8, width: '100%' }}
                onClick={handleOpenCloudBrowser}
              >
                ☁ From cloud
              </button>
            )}
          </div>
          <div className="sec" style={{ padding: '6px 14px' }}>
            <div className="cue-list-hdr">
              <span style={{ fontFamily: "'DM Mono'", fontSize: 9, color: 'var(--text3)', letterSpacing: 2 }}>
                CUE LIST
              </span>
              <div className="cue-list-hdr-right">
                <button
                  type="button"
                  className={`cue-loop-btn ${loopOn ? 'on-b' : ''}`}
                  onClick={() => setLoopOn((o) => !o)}
                  title={loopOn ? 'Loop playlist ON' : 'Loop playlist OFF'}
                >
                  Loop
                </button>
                <span className="cue-counter">
                  LIVE <b>{isLive ? programCueNum : '—'}</b> · NEXT <b>{nextCueNum}</b> / <b>{totalItems}</b>
                </span>
              </div>
            </div>
          </div>
          <div className="sec-overflow">
            <ul className="cue-list">
              {flatCueIds.length === 0 ? (
                <li className="empty-msg">Load images to start</li>
              ) : (
                sections.map((sec, secIdx) => {
                  let globalIdx = 0;
                  for (let i = 0; i < secIdx; i++) globalIdx += sections[i].cueIds.length;
                  const sectionStartIdx = globalIdx;
                  return (
                    <div key={sec.id} className="cue-list-section">
                      <li
                        className={`section-row ${!sec.collapsed ? 'open' : ''}`}
                        onClick={() => toggleSectionCollapsed(sec.id)}
                      >
                        <span
                          className="grp-chevron"
                          onClick={(e) => { e.stopPropagation(); toggleSectionCollapsed(sec.id); }}
                          title={sec.collapsed ? 'Expand' : 'Collapse'}
                        >
                          {sec.collapsed ? '▶' : '▼'}
                        </span>
                        <span className="section-name">{sec.name}</span>
                        <span className="section-count">{sec.cueIds.length}</span>
                        <div className="cue-actions" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="cue-act-btn" title="Move section up" onClick={() => moveSection(secIdx, -1)} disabled={secIdx === 0}>↑</button>
                          <button type="button" className="cue-act-btn" title="Move section down" onClick={() => moveSection(secIdx, 1)} disabled={secIdx === sections.length - 1}>↓</button>
                          {sections.length > 1 && (
                            <button type="button" className="cue-act-btn del" title="Remove section" onClick={() => removeSection(sec.id)}>✕</button>
                          )}
                        </div>
                      </li>
                      {!sec.collapsed && (
                        <>
                          {sec.cueIds.map((cueId, localIdx) => {
                            const cue = cues.find((c) => c.id === cueId);
                            if (!cue) return null;
                            const idx = sectionStartIdx + localIdx;
                            const isPgm = isLive && programCueItemIdx === idx;
                            const isPvw = previewCueId === cue.id;
                            return (
                              <li
                                key={cue.id}
                                className={`cue-item ${isPgm ? 'program' : ''} ${isPvw ? 'preview' : ''} ${analyzingCueId === cue.id ? 'analyzing' : ''}`}
                                onClick={() => setPreviewCueId(cue.id)}
                              >
                                <span className="cue-num">{String(idx + 1).padStart(2, '0')}</span>
                                <div className="cue-reorder">
                                  <button type="button" className="cue-act-btn" title="Move up" onClick={(e) => { e.stopPropagation(); moveCueInSection(sec.id, cue.id, -1); }} disabled={localIdx === 0}>↑</button>
                                  <button type="button" className="cue-act-btn" title="Move down" onClick={(e) => { e.stopPropagation(); moveCueInSection(sec.id, cue.id, 1); }} disabled={localIdx === sec.cueIds.length - 1}>↓</button>
                                </div>
                                {analyzingCueId === cue.id && <span className="cue-item-spinner" aria-hidden />}
                                <div className="cue-thumb-wrap">
                                  <MediaImg src={cue.src} userId={user?.id ?? null} className="cue-thumb" alt="" />
                                </div>
                                <div className="cue-info">
                                  <div className="cue-name">{getCueListLabel(cue)}</div>
                                  <div className="cue-meta">
                                    <span className={`cue-mode-badge ${(cue.mode ?? selectedMode) === 'fullscreen' ? 'mode-full' : (cue.mode ?? selectedMode) === 'blurbg' ? 'mode-blur' : 'mode-split'}`}>
                                      {(cue.mode ?? selectedMode) === 'fullscreen' ? 'FULL' : (cue.mode ?? selectedMode) === 'blurbg' ? 'BLUR' : 'SPLIT'}
                                    </span>
                                    <span className={`eoc-badge ${getCueEOC(cue, endOfCueBehavior) === 'hold' ? 'eoc-hold' : getCueEOC(cue, endOfCueBehavior) === 'fade' ? 'eoc-fade' : 'eoc-clear'}`}>
                                      {getCueEOC(cue, endOfCueBehavior) === 'hold' ? 'HOLD' : getCueEOC(cue, endOfCueBehavior) === 'fade' ? 'FADE OUT' : 'CLEAR'}
                                    </span>
                                    {cue.jumpToNext && <span className="cue-meta-icon cue-jump-icon" title="Jump to next at end">⏭</span>}
                                    {isCloudStoredCue(cue.src) && <span className="cue-mode-badge cue-cloud-badge-meta" title="Stored in cloud">☁</span>}
                                  </div>
                                </div>
                                <div className="cue-actions">
                                  <button type="button" className={`cue-act-btn ${cue.jumpToNext ? 'on-b' : ''}`} onClick={(e) => { e.stopPropagation(); setCues((prev) => prev.map((c) => c.id === cue.id ? { ...c, jumpToNext: !c.jumpToNext } : c)); }} title="At end: auto load next to preview and take">⏭</button>
                                  <button type="button" className="cue-act-btn cue-act-rename" onClick={(e) => { e.stopPropagation(); setRenameCueModal(cue); }} title="Custom name in cue list">⚙</button>
                                  <button type="button" className="cue-act-btn del" onClick={(e) => { e.stopPropagation(); setDeleteCueModal({ cue }); }}>✕</button>
                                </div>
                              </li>
                            );
                          })}
                          <div className="section-add-row" onClick={() => document.getElementById(`add-${sec.id}`)?.click()}>
                            <input type="file" id={`add-${sec.id}`} accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => handleFileInput(e, sec.id)} />
                            <span>＋ add to this section</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </ul>
            <div style={{ padding: '6px 10px' }}>
              <button type="button" className="btn-sm" onClick={addSection} title="New section for organization">
                ＋ New section
              </button>
            </div>
          </div>
        </div>

        {/* CENTER: MONITORS + TRANSPORT (transport pinned to bottom) */}
        <div className="monitor-area">
          <div className="monitor-area-scroll">
          <div className="monitor-toolbar">
            <span className="aspect-label">16:9</span>
          </div>

            <div
              ref={dualMonitorsRef}
              className="dual-monitors"
              id="dualMonitors"
              style={{ ['--pvw-split' as string]: `${pvwSplit}%` }}
            >
            <div className="monitor-col preview-col">
              <div className="monitor-header">
                <span className="monitor-label">PREVIEW</span>
                <span style={{ fontFamily: "'DM Mono'", fontSize: 8, color: 'var(--text2)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {previewCueId ? cues.find((c) => c.id === previewCueId)?.captionTitle || cues.find((c) => c.id === previewCueId)?.name || '—' : '—'}
                </span>
                <button
                  type="button"
                  className={`pvw-play-btn ${pvwPlaying ? 'playing' : ''}`}
                  title="Play preview motion"
                  onClick={handlePvwPlay}
                  disabled={!previewCue}
                >
                  {pvwPlaying ? '■ STOP' : '▶ PLAY'}
                </button>
              </div>
              <div className="monitor-stage preview-stage">
                <div className="preview-wrap pvw-wrap" data-asp="16:9">
                  <div className="preview-placeholder" style={{ display: previewCueId ? 'none' : 'flex' }}>
                    <div className="ph-icon">◫</div>
                    <div className="ph-txt">PREVIEW</div>
                  </div>
                  {previewCue && (
                    <MonitorLayer
                      cue={previewCue}
                      mode={effectivePreviewMode}
                      modeOpts={effectivePreviewModeOpts}
                      captionStyle={effectivePreviewCaptionStyle}
                      holdDuration={holdDuration}
                      zoomScale={zoomScale}
                      motionSpeed={motionSpeed}
                      kbDirection={panelKbDirection}
                      userId={user?.id ?? null}
                      playKey={pvwPlayKey}
                      showProgress={pvwPlaying}
                      staticKeyframe={panelKbDirection === 'custom' && previewCue.kbCustomStart && previewCue.kbCustomEnd && kbEditingFrame ? kbEditingFrame : undefined}
                    />
                  )}
                  <div className="monitor-overlay-label pvw-label">PVW</div>
                  <div className={`pvw-editing-badge ${previewCueId ? 'vis' : ''}`}>EDITING</div>
                </div>
              </div>
            </div>

            <div className="monitor-splitter" />

            <div className="monitor-col program-col">
              <div className="monitor-header">
                <span className="monitor-label pgm">● PROGRAM</span>
                <span style={{ fontFamily: "'DM Mono'", fontSize: 8, color: 'var(--text2)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {programCue ? (programCue.captionTitle || programCue.name) : '—'}
                </span>
                {isLive && programCue && (
                  <span className="monitor-trans-badge" title="Transition">
                    {((programCue.transitionType as TransitionType) ?? transitionType).toUpperCase() === 'CUT' ? 'CUT' : `${((programCue.transitionType as TransitionType) ?? transitionType).toUpperCase()} ${(programCue.transDuration != null ? programCue.transDuration : transDuration).toFixed(1)}s`}
                  </span>
                )}
              </div>
              <div className="monitor-stage program-stage">
                <div className="preview-wrap pgm-wrap" data-asp="16:9">
                  <div className="preview-placeholder" style={{ display: isLive && programCue ? 'none' : 'flex' }}>
                    <div className="ph-icon">◫</div>
                    <div className="ph-txt">AWAITING CUE</div>
                  </div>
                  {/* Program content: wrap in div for EOC transparent fade */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 9,
                      pointerEvents: 'none',
                      opacity: programEocContentOpacity,
                      transition: programEocFadeActive && programEocFadeTo === 'transparent' ? `opacity ${programEocFadeDuration}s ease` : 'none',
                    }}
                  >
                    {/* Program monitor: outgoing layer only during fade; same key as pre-fade single layer so it doesn't remount/jump */}
                    {isLive && programCrossfadeNextCue && (programOutgoingCue ?? programCue) && (
                      <div
                        key={`pgm-${programCueItemIdx}`}
                        className="play-layer"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 10,
                          pointerEvents: 'none',
                          opacity: programTransitionKind === 'wipe' ? 1 : programCrossfadeOutOpacity,
                          transition: programTransitionKind === 'wipe' ? 'none' : `opacity ${programCrossfadeDuration}s ease`,
                        }}
                      >
                        <MonitorLayer
                          cue={(programOutgoingCue ?? programCue)!}
                          mode={effectiveProgramMode}
                          modeOpts={effectiveProgramModeOpts}
                          captionStyle={effectiveProgramCaptionStyle}
                          holdDuration={holdDuration}
                          zoomScale={zoomScale}
                          motionSpeed={motionSpeed}
                          kbDirection={(programOutgoingCue ?? programCue)?.kbAnim ?? kbDirection}
                          userId={user?.id ?? null}
                          showProgress={false}
                        />
                      </div>
                    )}
                    {/* Program monitor: main layer (incoming during fade/wipe, then solo; same key so no remount when transition ends) */}
                    {isLive && (programCue || programOutgoingCue || programCrossfadeNextCue) && effectiveProgramCue && (
                      <div
                        key={`pgm-${effectiveProgramItemIdx}`}
                        className="play-layer"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: 11,
                          pointerEvents: 'none',
                          opacity: programTransitionKind === 'wipe' ? 1 : (programCrossfadeNextCue ? programCrossfadeInOpacity : 1),
                          transition: programTransitionKind === 'wipe' ? 'none' : (programCrossfadeNextCue ? `opacity ${programCrossfadeDuration}s ease` : 'none'),
                          ...(programTransitionKind === 'wipe' ? { clipPath: getWipeClipPath((effectiveProgramCue.wipeDirection as WipeDirection) ?? wipeDirection, programWipeRevealPct) } : {}),
                        }}
                      >
                        <MonitorLayer
                          cue={effectiveProgramCue}
                          mode={effectiveProgramCue?.mode ?? selectedMode}
                          modeOpts={effectiveProgramCue ? getCueModeOpts(effectiveProgramCue, modeOpts) : modeOpts}
                          captionStyle={effectiveProgramCue ? getCueCaptionStyle(effectiveProgramCue, captionStyle) : captionStyle}
                          holdDuration={holdDuration}
                          zoomScale={zoomScale}
                          motionSpeed={motionSpeed}
                          kbDirection={effectiveProgramCue?.kbAnim ?? kbDirection}
                          userId={user?.id ?? null}
                          showProgress={!programCrossfadeNextCue}
                        />
                      </div>
                    )}
                  </div>
                  {/* EOC fade to black overlay */}
                  {programEocFadeActive && programEocFadeTo === 'black' && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 20,
                        pointerEvents: 'none',
                        background: '#000',
                        opacity: programEocFadeOverlayOpacity,
                        transition: `opacity ${programEocFadeDuration}s ease`,
                      }}
                    />
                  )}
                  <div className="monitor-overlay-label pgm-label">PGM</div>
                  <div className={`playout-badge ${isLive ? 'vis' : ''}`}>● PLAYOUT</div>
                </div>
              </div>
            </div>
          </div>
          </div>

          <div className="transport">
            <div className="t-zone t-zone-nav">
              <button type="button" className="nav-btn" title="Select previous as NEXT" onClick={() => handleSelectPrevNext(-1)}>⏮</button>
              <button type="button" className="nav-btn" title="Select next as NEXT" onClick={() => handleSelectPrevNext(1)}>⏭</button>
            </div>
            <div className="t-zone-sep" />
            <div className={`t-zone t-zone-counter ${isLive ? 'is-live' : ''}`}>
              <div className={`t-counter-block t-counter-live ${isLive ? 'on-air' : ''}`}>
                <span className="t-counter-label">LIVE</span>
                <span className="t-counter-val"><b>{isLive ? programCueNum : '—'}</b></span>
              </div>
              <div className="t-counter-block t-counter-next">
                <span className="t-counter-label">NEXT</span>
                <span className="t-counter-val"><b>{nextCueNum}</b></span>
              </div>
              <span className="t-counter-total">/ {totalItems}</span>
            </div>
            <div className="t-zone-sep" />
            <div className="t-zone t-zone-progress">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="progress-track" style={{ flex: 1, position: 'relative' }} title={`Current cue: ${programTotalDur}s`}>
                  <div ref={progressFillRef} className="progress-fill" id="progressFill" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <div className="progress-labels progress-labels--centered">
                <span title="Elapsed">{isLive ? timeElapsed : '—'}</span>
                <span title="Remaining (countdown)">{isLive ? timeRemain : '—'}</span>
              </div>
              <div className="progress-status" title={isLive ? 'Time remaining on current cue' : 'Playback stopped'}>
                {isLive ? `Current cue time remaining: ${timeRemain}` : 'Not running'}
              </div>
            </div>
            <div className="t-zone-sep" />
            <div className="t-zone t-zone-pgm">
              <button
                type="button"
                className="pgm-btn fade-btn"
                title={fadeTo === 'black' ? 'Fade program to black' : 'Fade program to transparent'}
                onClick={() => {
                  if (!isLive) return;
                  sendToPlayout({ type: 'fadeOut', duration: fadeOutDur || 1, fadeTo }, playoutWindowRef.current);
                  setTimeout(() => {
                    setIsLive(false);
                    sendToPlayout({ type: 'stop' }, playoutWindowRef.current);
                  }, (fadeOutDur || 1) * 1000);
                }}
              >
                ↓ FADE
              </button>
              <select
                className="pgm-fade-to-select"
                value={fadeTo}
                onChange={(e) => setFadeTo(e.target.value as FadeTo)}
                title="Fade to black or transparent"
              >
                <option value="black">Black</option>
                <option value="transparent">Transparent</option>
              </select>
              <button type="button" className="pgm-btn cut-btn" title="Cut program to black" onClick={() => { setProgramEocFadeActive(false); setProgramEocFadeOverlayOpacity(0); setProgramEocContentOpacity(1); setIsLive(false); sendToPlayout({ type: 'stop' }, playoutWindowRef.current); }}>✕ CLEAR</button>
            </div>
            <div className="t-zone-sep" />
            <div className="t-zone t-zone-take">
              <button
                type="button"
                className={`take-btn ${isLive ? 'on-air' : ''}`}
                title="Take previewed cue to program"
                onClick={handleTakeToProgram}
              >
                TAKE LIVE
                <span className="take-key">SPACE</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: SETTINGS */}
        <div className="panel panel-right">
          <div className="settings-scroll" ref={settingsScrollRef}>
            <div className="settings-search-wrap">
              <input
                type="search"
                className="settings-search-input"
                placeholder="Search settings…"
                value={settingsSearchQuery}
                onChange={(e) => setSettingsSearchQuery(e.target.value)}
                aria-label="Search settings"
              />
              {!settingsSearchQuery.trim() && (
                <div className="settings-section-index">
                  {SECTION_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="settings-section-chip"
                      onClick={() => scrollToSection(key)}
                      title={`Jump to ${SECTION_META[key].label}`}
                    >
                      {SECTION_META[key].label}
                    </button>
                  ))}
                </div>
              )}
              {settingsSearchQuery.trim() && (
                <div className="settings-search-hint">
                  {visibleSectionKeys.length} section{visibleSectionKeys.length !== 1 ? 's' : ''} match
                </div>
              )}
            </div>
            <div className={`coll-sec ${!visibleSectionKeys.includes('aiAnalysis') ? 'settings-section-hidden' : ''}`} ref={(el) => { settingsSectionRefs.current.aiAnalysis = el; }} data-section="aiAnalysis">
              <div className={`coll-hdr ${openSections.aiAnalysis ? 'open' : ''}`} onClick={() => toggleSection('aiAnalysis')}>
                <div className="sec-label">AI Analysis</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sec-status" style={{ fontSize: 10 }}>
                    {analyzeOnImport ? (useAiAnalysis ? 'AI on' : 'Size only') : 'Off'}
                  </span>
                  <span className="coll-chevron">▶</span>
                </div>
              </div>
              <div className={`coll-body ${openSections.aiAnalysis ? 'open' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, fontSize: 11, color: 'var(--text2)' }}>
                  <label className="analysis-toggle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={analyzeOnImport}
                      onChange={(e) => setAnalyzeOnImport(e.target.checked)}
                    />
                    Analyze on import
                  </label>
                  <label className="analysis-toggle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={useAiAnalysis}
                      onChange={(e) => setUseAiAnalysis(e.target.checked)}
                    />
                    Use AI (content &amp; motion)
                  </label>
                </div>
                <div className="analysis-out">
                  {!previewCue ? (
                    <span style={{ color: 'var(--text3)', fontSize: 10 }}>Select a cue to begin...</span>
                  ) : analyzingCueId === previewCue.id ? (
                    <div className="analysis-processing" aria-busy="true">
                      <span className="analysis-spinner" aria-hidden />
                      <span>Analyzing image…</span>
                      <span style={{ fontSize: 10, color: 'var(--text3)' }}>{useAiAnalysis ? 'Content &amp; motion' : 'Image size'}</span>
                    </div>
                  ) : previewCue.analysis ? (
                    <div className="analysis-content" style={{ fontSize: 11, color: 'var(--text2)' }}>
                      <div style={{ marginBottom: 8, fontSize: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: previewCue.analysis.source === 'huggingface' ? 'var(--accent, #0a7)' : 'var(--text3)',
                          color: '#fff',
                          fontWeight: 600,
                        }}>
                          {previewCue.analysis.source === 'huggingface' ? 'AI' : 'Image size only'}
                        </span>
                        <span style={{ color: 'var(--text3)' }}>
                          {previewCue.analysis.source === 'huggingface' ? 'Caption &amp; motion from image' : 'Caption/mode from dimensions'}
                        </span>
                      </div>
                    {previewCue.analysis.debugMessage && (
                      <div style={{ marginBottom: 8, padding: 6, background: 'rgba(255,100,100,0.1)', borderRadius: 4, fontSize: 10, color: 'var(--text2)' }}>
                        <strong>Why no AI:</strong> {previewCue.analysis.debugMessage}
                      </div>
                    )}
                    {previewCue.analysis.caption && (
                      <div style={{ marginBottom: 4 }}><strong>Caption:</strong> {previewCue.analysis.caption}</div>
                    )}
                    {previewCue.analysis.mood && (
                      <div style={{ marginBottom: 4 }}><strong>Mood:</strong> {previewCue.analysis.mood}</div>
                    )}
                    {previewCue.analysis.composition && (
                      <div style={{ marginBottom: 4 }}><strong>Composition:</strong> {previewCue.analysis.composition}</div>
                    )}
                    {previewCue.analysis.recommendedMode && (
                      <div style={{ marginBottom: 4 }}>
                        <strong>Recommended mode:</strong> {previewCue.analysis.recommendedMode}
                        {previewCue.analysis.recommendReason && (
                          <span style={{ color: 'var(--text3)', fontSize: 10 }}> — {previewCue.analysis.recommendReason}</span>
                        )}
                      </div>
                    )}
                    {previewCue.analysis.kbAnim && (
                      <div style={{ marginBottom: 4 }}>
                        <strong>Motion:</strong> {previewCue.analysis.kbAnim}
                        {previewCue.analysis.kbAnimReason && (
                          <span style={{ color: 'var(--text3)', fontSize: 10 }}> — {previewCue.analysis.kbAnimReason}</span>
                        )}
                      </div>
                    )}
                    {previewCue.kbCustomStart && previewCue.kbCustomEnd && (
                      <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--text3)' }}>
                        Keyframes: full frame → subject (AI)
                      </div>
                    )}
                    {previewCue.analysis.tags?.length ? (
                      <div><strong>Tags:</strong> {previewCue.analysis.tags.join(', ')}</div>
                    ) : null}
                  </div>
                ) : (
                  <span style={{ color: 'var(--text3)', fontSize: 10 }}>No analysis for this cue. Enable “Analyze on import” and add images to get suggestions.</span>
                )}
                </div>
              </div>
            </div>

            <div className={`coll-sec ${false ? 'panel-cue-disabled-sec' : ''} ${!visibleSectionKeys.includes('playbackMode') ? 'settings-section-hidden' : ''}`} ref={(el) => { settingsSectionRefs.current.playbackMode = el; }} data-section="playbackMode">
              <div className={`coll-hdr ${openSections.playbackMode ? 'open' : ''}`} onClick={() => !(false) && toggleSection('playbackMode')}>
                <div className="sec-label">Playback Mode {panelCanEditCue && <span className="sec-applies">(this cue)</span>}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sec-status">{panelMode === 'fullscreen' ? 'Full Screen' : panelMode === 'blurbg' ? 'Blur BG' : 'Split'}</span>
                  <span className="coll-chevron">▶</span>
                </div>
              </div>
              <div className={`coll-body ${openSections.playbackMode ? 'open' : ''}`}>
                {false ? (
                  <div className="panel-cue-disabled">
                    <p className="panel-cue-disabled-msg">Select an image in the group to adjust settings.</p>
                  </div>
                ) : (
                <>
                <div className="mode-cards-mini">
                  {(['fullscreen', 'blurbg', 'split'] as const).map((mode) => (
                    <div
                      key={mode}
                      className={`mode-mini ${panelMode === mode ? 'sel' : ''}`}
                      data-mode={mode}
                      onClick={() => setPanelMode(mode)}
                    >
                      <div className="mode-mini-head">
                        <span className="mode-mini-icon" aria-hidden>
                          {mode === 'fullscreen' && (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                          )}
                          {mode === 'blurbg' && (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6" opacity="0.6"/><circle cx="12" cy="12" r="2" opacity="0.4"/></svg>
                          )}
                          {mode === 'split' && (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="9" height="18" rx="1"/><rect x="12" y="3" width="9" height="18" rx="1"/></svg>
                          )}
                        </span>
                        <span className="mode-mini-title">
                          {mode === 'fullscreen' ? 'Full Screen' : mode === 'blurbg' ? 'Blur Background' : 'Editorial Split'}
                        </span>
                      </div>
                      <div className="mode-mini-desc">
                        {mode === 'fullscreen' ? 'Fills frame — max impact' : mode === 'blurbg' ? 'Subject centred, blurred fill' : 'Image + caption / broadcast look'}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`mode-sub ${panelMode === 'fullscreen' ? 'active' : ''}`}>
                  <div className="mode-sub-lbl">FULLSCREEN OPTIONS</div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">Vignette Overlay <em>{panelModeOpts.fullscreen?.vignette ? 'On' : 'Off'}</em></div>
                    <div className="sel-row-2" style={{ marginTop: 4 }}>
                      <button type="button" className={`sel-btn ${!panelModeOpts.fullscreen?.vignette ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, fullscreen: { ...m.fullscreen, vignette: false } }))}>OFF</button>
                      <button type="button" className={`sel-btn ${panelModeOpts.fullscreen?.vignette ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, fullscreen: { ...m.fullscreen, vignette: true } }))}>ON</button>
                    </div>
                  </div>
                  <div className="ctrl-row" style={{ marginBottom: 0 }}>
                    <div className="ctrl-label">Object Fit <em>{(panelModeOpts.fullscreen?.objectFit ?? 'cover') === 'cover' ? 'Fill' : 'Fit'}</em></div>
                    <div className="sel-row-2" style={{ marginTop: 4 }}>
                      <button type="button" className={`sel-btn ${(panelModeOpts.fullscreen?.objectFit ?? 'cover') === 'cover' ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, fullscreen: { ...m.fullscreen, objectFit: 'cover' } }))}>Fill</button>
                      <button type="button" className={`sel-btn ${panelModeOpts.fullscreen?.objectFit === 'contain' ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, fullscreen: { ...m.fullscreen, objectFit: 'contain' } }))}>Fit</button>
                    </div>
                  </div>
                </div>
                <div className={`mode-sub ${panelMode === 'blurbg' ? 'active' : ''}`}>
                  <div className="mode-sub-lbl">BLUR BACKGROUND OPTIONS</div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">Blur Amount <em>{panelModeOpts.blurbg?.blurAmount ?? 28}px</em></div>
                    <input type="range" min={4} max={60} value={panelModeOpts.blurbg?.blurAmount ?? 28} onChange={(e) => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, blurAmount: Number(e.target.value) } }))} />
                  </div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">BG Brightness <em>{Math.round((panelModeOpts.blurbg?.bgBrightness ?? 0.45) * 100)}%</em></div>
                    <input type="range" min={5} max={90} value={Math.round((panelModeOpts.blurbg?.bgBrightness ?? 0.45) * 100)} onChange={(e) => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, bgBrightness: Number(e.target.value) / 100 } }))} />
                  </div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">Frame width <em>{panelModeOpts.blurbg?.frameWidth ?? 70}%</em></div>
                    <input type="range" min={30} max={100} value={panelModeOpts.blurbg?.frameWidth ?? 70} onChange={(e) => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, frameWidth: Number(e.target.value) } }))} />
                  </div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">Frame height <em>{panelModeOpts.blurbg?.frameHeight ?? 70}%</em></div>
                    <input type="range" min={30} max={100} value={panelModeOpts.blurbg?.frameHeight ?? 70} onChange={(e) => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, frameHeight: Number(e.target.value) } }))} />
                  </div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">Fill frame <em>{panelModeOpts.blurbg?.fillFrame !== false ? 'On' : 'Off'}</em></div>
                    <div className="sel-row-2" style={{ marginTop: 4 }}>
                      <button type="button" className={`sel-btn ${panelModeOpts.blurbg?.fillFrame === false ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, fillFrame: false } }))}>OFF</button>
                      <button type="button" className={`sel-btn ${panelModeOpts.blurbg?.fillFrame !== false ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, fillFrame: true } }))}>ON</button>
                    </div>
                    <div className="ctrl-hint" style={{ marginTop: 2 }}>Pre-zoom image to fill frame edge-to-edge (no empty space). Motion presets run on top.</div>
                  </div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">Border <em>{panelModeOpts.blurbg?.showBorder ? 'On' : 'Off'}</em></div>
                    <div className="sel-row-2" style={{ marginTop: 4 }}>
                      <button type="button" className={`sel-btn ${!panelModeOpts.blurbg?.showBorder ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, showBorder: false } }))}>OFF</button>
                      <button type="button" className={`sel-btn ${panelModeOpts.blurbg?.showBorder ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, showBorder: true } }))}>ON</button>
                    </div>
                  </div>
                  {(panelModeOpts.blurbg?.showBorder) && (
                    <>
                      <div className="ctrl-row">
                        <div className="ctrl-label">Border width <em>{panelModeOpts.blurbg?.borderWidth ?? 2}px</em></div>
                        <input type="range" min={1} max={12} value={panelModeOpts.blurbg?.borderWidth ?? 2} onChange={(e) => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, borderWidth: Number(e.target.value) } }))} />
                      </div>
                      <div className="ctrl-row" style={{ marginBottom: 0 }}>
                        <div className="ctrl-label">Border color</div>
                        <input type="color" value={panelModeOpts.blurbg?.borderColor ?? '#ffffff'} onChange={(e) => setPanelModeOpts((m) => ({ ...m, blurbg: { ...DEFAULT_MODE_OPTS.blurbg, ...m.blurbg, borderColor: e.target.value } }))} style={{ width: 40, height: 28, padding: 0, border: '1px solid var(--border2)', borderRadius: 4 }} />
                      </div>
                    </>
                  )}
                </div>
                <div className={`mode-sub ${panelMode === 'split' ? 'active' : ''}`}>
                  <div className="mode-sub-lbl">SPLIT LAYOUT OPTIONS</div>
                  <div className="ctrl-row">
                    <div className="ctrl-label">Photo placement</div>
                    <div className="sel-row-3" style={{ marginTop: 4 }}>
                      <button type="button" className={`sel-btn ${(panelModeOpts.split?.splitImageSide ?? 'left') === 'left' ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, split: { ...m.split, splitImageSide: 'left' } }))}>Left</button>
                      <button type="button" className={`sel-btn ${(panelModeOpts.split?.splitImageSide ?? 'left') === 'center' ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, split: { ...m.split, splitImageSide: 'center' } }))}>Center</button>
                      <button type="button" className={`sel-btn ${(panelModeOpts.split?.splitImageSide ?? 'left') === 'right' ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, split: { ...m.split, splitImageSide: 'right' } }))}>Right</button>
                    </div>
                  </div>
                  {(panelModeOpts.split?.splitImageSide ?? 'left') === 'center' && (
                    <>
                      <div className="ctrl-row">
                        <div className="ctrl-label">Photo width <em>{panelModeOpts.split?.splitCenterWidth ?? 40}%</em></div>
                        <input type="range" min={20} max={80} value={panelModeOpts.split?.splitCenterWidth ?? 40} onChange={(e) => setPanelModeOpts((m) => ({ ...m, split: { ...m.split, splitCenterWidth: Number(e.target.value) } }))} />
                      </div>
                      <div className="ctrl-row">
                        <div className="ctrl-label">Photo height <em>{Math.min(panelModeOpts.split?.splitCenterHeight ?? 45, 65)}%</em></div>
                        <input type="range" min={20} max={65} value={Math.min(panelModeOpts.split?.splitCenterHeight ?? 45, 65)} onChange={(e) => setPanelModeOpts((m) => ({ ...m, split: { ...m.split, splitCenterHeight: Number(e.target.value) } }))} />
                      </div>
                    </>
                  )}
                  {(panelModeOpts.split?.splitImageSide ?? 'left') !== 'center' && (
                    <div className="ctrl-row">
                      <div className="ctrl-label">Image Width <em>{panelModeOpts.split?.splitImgWidth ?? 55}%</em></div>
                      <input type="range" min={30} max={70} value={panelModeOpts.split?.splitImgWidth ?? 55} onChange={(e) => setPanelModeOpts((m) => ({ ...m, split: { ...m.split, splitImgWidth: Number(e.target.value) } }))} />
                    </div>
                  )}
                  <div className="ctrl-row">
                    <div className="ctrl-label">Text Align</div>
                    <div className="sel-row-3" style={{ marginTop: 4 }}>
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button key={align} type="button" className={`sel-btn ${(panelModeOpts.split?.splitTextAlign ?? 'left') === align ? 'on-b' : ''}`} onClick={() => setPanelModeOpts((m) => ({ ...m, split: { ...m.split, splitTextAlign: align } }))}>
                          {align === 'left' ? 'LEFT' : align === 'center' ? 'CTR' : 'RIGHT'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                </>
                )}
              </div>
            </div>

            <div className={`coll-sec ${false ? 'panel-cue-disabled-sec' : ''} ${!visibleSectionKeys.includes('timing') ? 'settings-section-hidden' : ''}`} ref={(el) => { settingsSectionRefs.current.timing = el; }} data-section="timing">
              <div className={`coll-hdr ${openSections.timing ? 'open' : ''}`} onClick={() => !(false) && toggleSection('timing')}>
                <div className="sec-label">Timing {panelCanEditCue && <span className="sec-applies">(this cue)</span>}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sec-status">{panelHoldDuration}s · FADE {panelFadeInDur}/{panelFadeOutDur}</span>
                  <span className="coll-chevron">▶</span>
                </div>
              </div>
              <div className={`coll-body ${openSections.timing ? 'open' : ''}`}>
                {false ? (
                  <div className="panel-cue-disabled">
                    <p className="panel-cue-disabled-msg">Select an image in the group to adjust settings.</p>
                  </div>
                ) : (
                <>
                <div className="ctrl-row">
                  <div className="ctrl-label">Hold Duration <em>{panelHoldDuration}s</em></div>
                  <input type="range" min={2} max={60} value={panelHoldDuration} onChange={(e) => setPanelHoldDuration(Number(e.target.value))} />
                </div>
                <div className="timing-row">
                  <div className="timing-field">
                    <label>FADE IN (s)</label>
                    <input type="number" min={0} max={10} step={0.1} value={panelFadeInDur} onChange={(e) => setPanelFadeInDur(Number(e.target.value) || 0)} />
                  </div>
                  <div className="timing-field">
                    <label>FADE OUT (s)</label>
                    <input type="number" min={0} max={10} step={0.1} value={panelFadeOutDur} onChange={(e) => setPanelFadeOutDur(Number(e.target.value) || 0)} />
                  </div>
                </div>
                <div className="ctrl-row" style={{ marginTop: 8 }}>
                  <div className="ctrl-label">Fade to</div>
                  <div className="sel-row-3" style={{ flex: 1, justifyContent: 'flex-start' }}>
                    <button type="button" className={`sel-btn ${fadeTo === 'black' ? 'on-b' : ''}`} onClick={() => setFadeTo('black')}>Black</button>
                    <button type="button" className={`sel-btn ${fadeTo === 'transparent' ? 'on-b' : ''}`} onClick={() => setFadeTo('transparent')}>Transparent</button>
                  </div>
                </div>
                </>
                )}
              </div>
            </div>

            <div className={`coll-sec ${!visibleSectionKeys.includes('eoc') ? 'settings-section-hidden' : ''}`} ref={(el) => { settingsSectionRefs.current.eoc = el; }} data-section="eoc">
              <div className={`coll-hdr ${openSections.eoc ? 'open' : ''}`} onClick={() => toggleSection('eoc')}>
                <div className="sec-label">End of Cue {panelAppliesToCue && <span className="sec-applies">(this cue)</span>}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sec-status">{panelEndOfCueBehavior === 'hold' ? 'HOLD' : panelEndOfCueBehavior === 'fade' ? 'FADE' : 'CLEAR'}</span>
                  <span className="coll-chevron">▶</span>
                </div>
              </div>
              <div className={`coll-body ${openSections.eoc ? 'open' : ''}`}>
                <div className="sel-row-3">
                  {(['hold', 'fade', 'clear'] as const).map((eoc) => (
                    <button key={eoc} type="button" className={`sel-btn ${panelEndOfCueBehavior === eoc ? 'on-b' : ''}`} onClick={() => setPanelEndOfCueBehavior(eoc)}>
                      {eoc === 'hold' ? 'HOLD' : eoc === 'fade' ? 'FADE' : 'CLEAR'}
                    </button>
                  ))}
                </div>
                <div className="eoc-hint" style={{ marginTop: 10 }}>
                  HOLD: stay on last frame. FADE: uses the Fade out time from Timing (above). CLEAR: cut to black.
                </div>
              </div>
            </div>

            <div className={`coll-sec ${!visibleSectionKeys.includes('motion') ? 'settings-section-hidden' : ''}`} ref={(el) => { settingsSectionRefs.current.motion = el; }} data-section="motion">
              <div className={`coll-hdr ${openSections.motion ? 'open' : ''}`} onClick={() => toggleSection('motion')}>
                <div className="sec-label">Motion {panelCanEditCue && <span className="sec-applies">(this cue)</span>}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sec-status">{panelKbDirection === 'auto' ? 'Auto (AI)' : panelKbDirection}</span>
                  <span className="coll-chevron">▶</span>
                </div>
              </div>
              <div className={`coll-body ${openSections.motion ? 'open' : ''}`}>
                {false ? (
                  <div className="panel-cue-disabled">
                    <p className="panel-cue-disabled-msg">Select an image in the group to adjust settings.</p>
                  </div>
                ) : (
                <>
                <div className="ctrl-row">
                  <div className="kb-grid">
                    {KB_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`kb-btn ${opt === 'auto' ? 'kbauto' : ''} ${opt === 'custom' ? 'custom-pan' : ''} ${panelKbDirection === opt ? 'active' : ''}`}
                        style={opt === 'custom' ? { gridColumn: 'span 3' } : undefined}
                        onClick={() => {
                          setPanelKbDirection(opt);
                          if (opt === 'custom') setOpenSections((s) => ({ ...s, motion: true }));
                        }}
                      >
                        {opt === 'auto' ? 'AUTO' : opt === 'zoom-in' ? 'ZOOM IN' : opt === 'zoom-out' ? 'ZOOM OUT' : opt === 'pan-right' ? 'PAN →' : opt === 'pan-left' ? '← PAN' : opt === 'drift' ? 'DRIFT' : '✦ CUSTOM — set start & end points'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`kb-point-editor ${panelKbDirection === 'custom' && previewCue ? 'visible' : ''}`}>
                  {previewCue && previewCueId && previewCue.src && (() => {
                    const startXYZ = getCueStartXYZ(previewCue) ?? { cx: 50, cy: 50, z: 1 };
                    const endXYZ = getCueEndXYZ(previewCue) ?? { cx: 50, cy: 50, z: 2 };
                    const kbScale = getKBScaleVar(previewCue, panelZoomScale);
                    const sectionStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '10px 12px', marginBottom: 8 };
                    const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8, display: 'block' };
                    function setAxis(which: 'start' | 'end', axis: 'cx' | 'cy' | 'z', raw: number) {
                      if (!previewCueId) return;
                      const cur = which === 'start' ? startXYZ : endXYZ;
                      const next = { ...cur, [axis]: raw };
                      setCues((prev) => applyXYZ(prev, previewCueId, which, next.cx, next.cy, next.z));
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="kb-pick-row">
                          <button type="button" className={`kb-pick-btn ${kbEditingFrame === 'start' ? 'active-start' : ''}`} onClick={() => setKbEditingFrame((f) => (f === 'start' ? null : 'start'))}>View Start</button>
                          <button type="button" className={`kb-pick-btn ${kbEditingFrame === 'end' ? 'active-end' : ''}`} onClick={() => setKbEditingFrame((f) => (f === 'end' ? null : 'end'))}>View End</button>
                        </div>
                        <ThumbnailOverlay imageSrc={previewCue.src} userId={user?.id ?? null} startXYZ={startXYZ} endXYZ={endXYZ} kbScale={kbScale} editingFrame={kbEditingFrame} />
                        <div style={sectionStyle}>
                          <span style={{ ...labelStyle, color: '#f5c518' }}>▶ START</span>
                          <AxisSlider label="X" value={startXYZ.cx} min={X_MIN} max={X_MAX} step={1} color="#f5c518" onChange={(v) => setAxis('start', 'cx', v)} />
                          <AxisSlider label="Y" value={startXYZ.cy} min={Y_MIN} max={Y_MAX} step={1} color="#f5c518" onChange={(v) => setAxis('start', 'cy', v)} />
                          <AxisSlider label="Z" value={startXYZ.z} min={Z_MIN} max={Z_MAX} step={Z_STEP} color="#f5c518" onChange={(v) => setAxis('start', 'z', v)} />
                        </div>
                        <div style={sectionStyle}>
                          <span style={{ ...labelStyle, color: '#3b9eff' }}>■ END</span>
                          <AxisSlider label="X" value={endXYZ.cx} min={X_MIN} max={X_MAX} step={1} color="#3b9eff" onChange={(v) => setAxis('end', 'cx', v)} />
                          <AxisSlider label="Y" value={endXYZ.cy} min={Y_MIN} max={Y_MAX} step={1} color="#3b9eff" onChange={(v) => setAxis('end', 'cy', v)} />
                          <AxisSlider label="Z" value={endXYZ.z} min={Z_MIN} max={Z_MAX} step={Z_STEP} color="#3b9eff" onChange={(v) => setAxis('end', 'z', v)} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
                          X,Y = center (0–100). Z = zoom (1 = full frame, 2 = 2× zoom). Boxes above are <em>display only</em> — sliders are the source of truth.
                        </div>
                        <div className="kb-point-actions" style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="kb-point-btn" style={{ flex: 1 }} onClick={() => setCues((prev) => prev.map((c) => {
                            if (c.id !== previewCueId || !c.kbCustomStart || !c.kbCustomEnd) return c;
                            return { ...c, kbCustomStart: c.kbCustomEnd, kbCustomEnd: c.kbCustomStart, kbStartCx: c.kbEndCx, kbStartCy: c.kbEndCy, kbStartZ: c.kbEndZ, kbEndCx: c.kbStartCx, kbEndCy: c.kbStartCy, kbEndZ: c.kbStartZ };
                          }))}>⇄ Swap</button>
                          <button type="button" className="kb-point-btn" style={{ flex: 1 }} onClick={() => setCues((prev) => applyXYZ(applyXYZ(prev, previewCueId, 'start', 50, 50, 1), previewCueId, 'end', 50, 50, 2))}>↺ Reset</button>
                          <button type="button" className="kb-point-btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => setPvwPlayKey((k) => k + 1)}>▶ Preview</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div style={{ marginTop: 10 }}>
                  <button type="button" className={`adv-toggle ${motionAdvOpen ? 'open' : ''}`} onClick={() => setMotionAdvOpen((o) => !o)}>Advanced ›</button>
                </div>
                {motionAdvOpen && (
                  <div className="ctrl-row" style={{ marginTop: 8 }}>
                    <div className="ctrl-label">Zoom scale <em>1 = 1:1; multiplies custom Z</em></div>
                    <input type="range" min={1} max={5} value={panelZoomScale} onChange={(e) => setPanelZoomScale(Number(e.target.value))} />
                  </div>
                )}
                {motionAdvOpen && (
                  <div className="ctrl-row" style={{ marginTop: 4, marginBottom: 0 }}>
                    <div className="ctrl-label">Motion speed <em>1–5</em></div>
                    <input type="range" min={1} max={5} value={panelMotionSpeed} onChange={(e) => setPanelMotionSpeed(Number(e.target.value))} />
                  </div>
                )}
                </>
                )}
              </div>
            </div>

            <div className={`coll-sec ${false ? 'panel-cue-disabled-sec' : ''} ${!visibleSectionKeys.includes('transition') ? 'settings-section-hidden' : ''}`} ref={(el) => { settingsSectionRefs.current.transition = el; }} data-section="transition">
              <div className={`coll-hdr ${openSections.transition ? 'open' : ''}`} onClick={() => !(false) && toggleSection('transition')}>
                <div className="sec-label">Transition {panelCanEditCue && <span className="sec-applies">(this cue)</span>}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sec-status">{panelTransitionType.toUpperCase()} · {panelTransDuration}s</span>
                  <span className="coll-chevron">▶</span>
                </div>
              </div>
              <div className={`coll-body ${openSections.transition ? 'open' : ''}`}>
                {false ? (
                  <div className="panel-cue-disabled">
                    <p className="panel-cue-disabled-msg">Select an image in the group to adjust settings.</p>
                  </div>
                ) : (
                <>
                <div className="ctrl-row">
                  <div className="trans-grid">
                    {TRANS_TYPES.map((t) => (
                      <button key={t} type="button" className={`trans-opt ${panelTransitionType === t ? 'active' : ''}`} onClick={() => setPanelTransitionType(t)}>
                        {t === 'fade' ? 'FADE' : t === 'wipe' ? 'WIPE' : t === 'dip' ? 'DIP' : 'CUT'}
                      </button>
                    ))}
                  </div>
                </div>
                {panelTransitionType !== 'cut' && (
                <>
                <div className="ctrl-row" style={{ marginTop: 8, marginBottom: 0 }}>
                  <div className="ctrl-label">Transition duration <em>{panelTransDuration.toFixed(1)}s</em></div>
                  <input type="range" min={2} max={20} step={1} value={Math.round(panelTransDuration * 10)} onChange={(e) => setPanelTransDuration(Number(e.target.value) / 10)} />
                </div>
                {panelTransitionType === 'wipe' && (
                <div className="ctrl-row" style={{ marginTop: 8, marginBottom: 0, flexWrap: 'wrap', gap: 6 }}>
                  <div className="ctrl-label" style={{ width: '100%' }}>Wipe direction</div>
                  {WIPE_DIRECTIONS_CARDINAL.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`trans-opt ${panelWipeDirection === d ? 'active' : ''}`}
                      onClick={() => setPanelWipeDirection(d)}
                      title={d}
                    >
                      {d === 'left' ? '← Left' : d === 'right' ? '→ Right' : d === 'up' ? '↑ Up' : '↓ Down'}
                    </button>
                  ))}
                </div>
                )}
                {panelTransitionType === 'dip' && (
                <div className="ctrl-row" style={{ marginTop: 8, marginBottom: 0, alignItems: 'center', gap: 8 }}>
                  <div className="ctrl-label">Dip color</div>
                  <input
                    type="color"
                    value={panelDipColor}
                    onChange={(e) => setPanelDipColor(e.target.value)}
                    style={{ width: 32, height: 24, padding: 0, border: '1px solid var(--border)', cursor: 'pointer' }}
                    title="Color to dip to"
                  />
                  <input
                    type="text"
                    value={panelDipColor}
                    onChange={(e) => setPanelDipColor(e.target.value)}
                    placeholder="#000000"
                    style={{ width: 72, fontFamily: "'DM Mono'", fontSize: 11 }}
                  />
                </div>
                )}
                </>
                )}
                </>
                )}
              </div>
            </div>

            <div className={`coll-sec ${false ? 'panel-cue-disabled-sec' : ''} ${!visibleSectionKeys.includes('caption') ? 'settings-section-hidden' : ''}`} ref={(el) => { settingsSectionRefs.current.caption = el; }} data-section="caption">
              <div className={`coll-hdr ${openSections.caption ? 'open' : ''}`} onClick={() => !(false) && toggleSection('caption')}>
                <div className="sec-label">Caption {panelCanEditCue && <span className="sec-applies">(this cue)</span>}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <div className="caption-toggle-pill">
                    <button type="button" className={panelCaptionStyle.position !== 'off' ? 'active-on' : ''} onClick={() => setPanelCaptionStyle((c) => ({ ...c, position: c.position === 'off' ? 'bottom' : c.position }))}>ON</button>
                    <button type="button" className={panelCaptionStyle.position === 'off' ? 'active-off' : ''} onClick={() => setPanelCaptionStyle((c) => ({ ...c, position: 'off' }))}>OFF</button>
                  </div>
                  <span className="coll-chevron">▶</span>
                </div>
              </div>
              <div className={`coll-body ${openSections.caption ? 'open' : ''}`}>
                {false ? (
                  <div className="panel-cue-disabled">
                    <p className="panel-cue-disabled-msg">Select an image in the group to adjust settings.</p>
                  </div>
                ) : (
                <>
                <div className="caption-field">
                  <label>TITLE TEXT</label>
                  <input
                    type="text"
                    placeholder="Leave blank to use AI caption…"
                    value={previewCue?.captionTitle ?? ''}
                    onChange={(e) => {
                      if (!previewCueId) return;
                      setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, captionTitle: e.target.value } : c)));
                    }}
                  />
                </div>
                <div className="caption-field">
                  <label>SUBTITLE</label>
                  <input
                    type="text"
                    placeholder="Optional second line…"
                    value={previewCue?.captionSub ?? ''}
                    onChange={(e) => {
                      if (!previewCueId) return;
                      setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, captionSub: e.target.value } : c)));
                    }}
                  />
                </div>
                <div className="caption-field" style={{ marginBottom: 0 }}>
                  <label>TAG LINE</label>
                  <input
                    type="text"
                    placeholder="e.g. LIVE · BREAKING · REPORT"
                    value={previewCue?.captionTag ?? ''}
                    onChange={(e) => {
                      if (!previewCueId) return;
                      setCues((prev) => prev.map((c) => (c.id === previewCueId ? { ...c, captionTag: e.target.value } : c)));
                    }}
                  />
                </div>
                {(panelMode === 'fullscreen' || panelMode === 'blurbg') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'DM Mono'", fontSize: 9, color: 'var(--text2)', letterSpacing: 1, flexShrink: 0 }}>JUSTIFY</span>
                    <div className="sel-row-2" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                      <button type="button" className={`caption-pos-btn ${(panelCaptionStyle.justify ?? 'left') === 'left' ? 'active' : ''}`} onClick={() => setPanelCaptionStyle((c) => ({ ...c, justify: 'left' }))}>LEFT</button>
                      <button type="button" className={`caption-pos-btn ${(panelCaptionStyle.justify ?? 'left') === 'center' ? 'active' : ''}`} onClick={() => setPanelCaptionStyle((c) => ({ ...c, justify: 'center' }))}>CTR</button>
                      <button type="button" className={`caption-pos-btn ${(panelCaptionStyle.justify ?? 'left') === 'right' ? 'active' : ''}`} onClick={() => setPanelCaptionStyle((c) => ({ ...c, justify: 'right' }))}>RIGHT</button>
                    </div>
                  </div>
                  <span style={{ fontFamily: "'Barlow'", fontSize: 10, color: 'var(--text3)', lineHeight: 1.3 }}>
                    Text alignment in the lower-third bar.
                  </span>
                </div>
              )}
                <div className="sec-label" style={{ marginBottom: 6 }}>Style</div>
                <div className="caption-color-row">
                  <div className="caption-color-item"><label>TEXT</label><input type="color" value={panelCaptionStyle.textColor} onChange={(e) => setPanelCaptionStyle((c) => ({ ...c, textColor: e.target.value }))} /></div>
                  <div className="caption-color-item"><label>ACCENT</label><input type="color" value={panelCaptionStyle.accentColor} onChange={(e) => setPanelCaptionStyle((c) => ({ ...c, accentColor: e.target.value }))} /></div>
                  <div className="caption-color-item"><label>BG</label><input type="color" value={panelCaptionStyle.bgColor} onChange={(e) => setPanelCaptionStyle((c) => ({ ...c, bgColor: e.target.value }))} /></div>
                </div>
                <div className="caption-opacity-row">
                  <label>OPACITY</label>
                  <input type="range" min={0} max={100} value={panelCaptionStyle.bgOpacity} onChange={(e) => setPanelCaptionStyle((c) => ({ ...c, bgOpacity: Number(e.target.value) }))} />
                  <span style={{ fontFamily: "'DM Mono'", fontSize: 9, color: 'var(--text2)', minWidth: 28 }}>{panelCaptionStyle.bgOpacity}%</span>
                </div>
                <div className="caption-opacity-row" style={{ marginTop: 6 }}>
                  <label>TEXT SIZE</label>
                  <select
                    value={String(panelCaptionStyle.textScale ?? 1)}
                    onChange={(e) => setPanelCaptionStyle((c) => ({ ...c, textScale: Number(e.target.value) }))}
                    style={{
                      padding: '4px 8px',
                      fontFamily: "'DM Mono'",
                      fontSize: 11,
                      background: 'var(--s3)',
                      border: '1px solid var(--border2)',
                      borderRadius: 4,
                      color: 'var(--text)',
                      outline: 'none',
                    }}
                  >
                    <option value="0.75">75%</option>
                    <option value="0.9">90%</option>
                    <option value="1">100%</option>
                    <option value="1.1">110%</option>
                    <option value="1.25">125%</option>
                    <option value="1.5">150%</option>
                  </select>
                </div>
                <div className="caption-opacity-row" style={{ marginTop: 6 }}>
                  <label>Y ADJUST</label>
                  <input
                    type="range"
                    min={-80}
                    max={80}
                    value={panelCaptionStyle.offsetY ?? 0}
                    onChange={(e) => setPanelCaptionStyle((c) => ({ ...c, offsetY: Number(e.target.value) }))}
                    style={{ flex: 1, maxWidth: 120 }}
                  />
                  <span style={{ fontFamily: "'DM Mono'", fontSize: 9, color: 'var(--text2)', minWidth: 32 }}>{panelCaptionStyle.offsetY ?? 0}px</span>
                </div>
                <div className="caption-preview-bar" style={{ marginTop: 12 }}>
                  <div className="cpb-bg" />
                  <div className="cpb-text">
                    <div className="cpb-tag" />
                    <div className="cpb-title">Caption Preview</div>
                    <div className="cpb-sub" style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }} />
                  </div>
                </div>
                </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {renameCueModal && (
        <div
          className="settings-modal-overlay"
          onClick={() => setRenameCueModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-cue-modal-title"
        >
          <div className="settings-modal rename-cue-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h2 id="rename-cue-modal-title" className="settings-modal-title">Name in cue list</h2>
              <button type="button" className="settings-modal-close" onClick={() => setRenameCueModal(null)} aria-label="Close">✕</button>
            </div>
            <div className="settings-modal-body">
              <p className="settings-hint" style={{ marginBottom: 8 }}>Custom name shown in the cue list. Leave blank to use the file name.</p>
              <input
                type="text"
                className="rename-cue-input"
                value={renameCueInput}
                onChange={(e) => setRenameCueInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = renameCueInput.trim(); setCues((prev) => prev.map((c) => c.id === renameCueModal.id ? { ...c, displayName: v || undefined } : c)); setRenameCueModal(null); } }}
                placeholder={renameCueModal.name}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn-sm" onClick={() => { const v = renameCueInput.trim(); setCues((prev) => prev.map((c) => c.id === renameCueModal.id ? { ...c, displayName: v || undefined } : c)); setRenameCueModal(null); }}>
                  Save
                </button>
                <button type="button" className="btn-sm" onClick={() => { setCues((prev) => prev.map((c) => c.id === renameCueModal.id ? { ...c, displayName: undefined } : c)); setRenameCueModal(null); }}>
                  Clear (use file name)
                </button>
                <button type="button" className="btn-sm" onClick={() => setRenameCueModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteCueModal && (
        <div
          className="settings-modal-overlay"
          onClick={() => setDeleteCueModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-cue-modal-title"
        >
          <div className="settings-modal delete-cue-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h2 id="delete-cue-modal-title" className="settings-modal-title">Remove cue</h2>
              <button type="button" className="settings-modal-close" onClick={() => setDeleteCueModal(null)} aria-label="Close">✕</button>
            </div>
            <div className="settings-modal-body">
              <p className="settings-hint" style={{ marginBottom: 12 }}>
                {getCueListLabel(deleteCueModal.cue)}
              </p>
              {isCloudStoredCue(deleteCueModal.cue.src) ? (
                <>
                  <button type="button" className="btn-sm" style={{ marginRight: 8, marginBottom: 8 }} onClick={() => handleRemoveCue(false)}>
                    Remove from project only
                  </button>
                  <button type="button" className="btn-sm" style={{ marginBottom: 8 }} onClick={() => handleRemoveCue(true)}>
                    Remove and delete from cloud
                  </button>
                </>
              ) : (
                <button type="button" className="btn-sm" onClick={() => handleRemoveCue(false)}>
                  Remove from project
                </button>
              )}
              <button type="button" className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setDeleteCueModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {cloudBrowserOpen && user && (
        <div
          className="settings-modal-overlay"
          onClick={() => setCloudBrowserOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-browser-title"
        >
          <div className="settings-modal cloud-browser-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h2 id="cloud-browser-title" className="settings-modal-title">Import from cloud</h2>
              <button type="button" className="settings-modal-close" onClick={() => setCloudBrowserOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="settings-modal-body">
              {cloudFilesLoading ? (
                <p className="settings-hint">Loading…</p>
              ) : cloudFiles.length === 0 ? (
                <p className="settings-hint">No images in your cloud yet. Upload with “Store images: Cloud” in Settings.</p>
              ) : (
                <>
                  <div className="cloud-browser-grid">
                    {cloudFiles.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={`cloud-browser-item ${cloudSelected.has(file.path) ? 'selected' : ''}`}
                        onClick={() => toggleCloudSelected(file.path)}
                      >
                        <MediaImg src={file.path} userId={user.id} className="cloud-browser-thumb" alt="" />
                        <span className="cloud-browser-name">{file.name}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button type="button" className="btn-sm" onClick={handleAddFromCloud} disabled={cloudSelected.size === 0}>
                      Add selected ({cloudSelected.size})
                    </button>
                    <button type="button" className="btn-sm" onClick={() => setCloudBrowserOpen(false)}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {settingsModalOpen && (
        <div
          className="settings-modal-overlay"
          onClick={() => setSettingsModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
        >
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h2 id="settings-modal-title" className="settings-modal-title">Settings</h2>
              <button
                type="button"
                className="settings-modal-close"
                onClick={() => setSettingsModalOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="settings-modal-body">
              <div className="settings-row">
                <span className="settings-label">Store images</span>
                <div className="settings-control">
                  <label className="settings-radio">
                    <input
                      type="radio"
                      name="storeImages"
                      checked={storeImagesMode === 'local'}
                      onChange={() => setStoreImagesMode('local')}
                    />
                    Local
                  </label>
                  <label className={`settings-radio ${!user ? 'disabled' : ''}`}>
                    <input
                      type="radio"
                      name="storeImages"
                      checked={storeImagesMode === 'hybrid'}
                      onChange={() => setStoreImagesMode('hybrid')}
                      disabled={!user}
                    />
                    Hybrid {!user && '(sign in)'}
                  </label>
                  <label className={`settings-radio ${!user ? 'disabled' : ''}`}>
                    <input
                      type="radio"
                      name="storeImages"
                      checked={storeImagesMode === 'cloud'}
                      onChange={() => setStoreImagesMode('cloud')}
                      disabled={!user}
                    />
                    Cloud {!user && '(sign in)'}
                  </label>
                </div>
              </div>
              <p className="settings-hint">
                Local: data in project. Hybrid: local + import from cloud. Cloud: upload to your account.
              </p>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
