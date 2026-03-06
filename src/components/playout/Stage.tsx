/**
 * Playout stage — connection by code, then transparent full-screen program output.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { PlayoutPayload, WipeDirection } from '../../lib/types';
import type { PlayoutMessage } from '../../lib/playoutChannel';
import { subscribeToPlayout, subscribeToWindowMessage, getPlayoutChannel, connectToPlayoutChannelAsPlayout, HEARTBEAT_INTERVAL_MS } from '../../lib/playoutChannel';
import {
  getKBAnimationName,
  applyCustomKBKeyframes,
  applyCustomKBKeyframesFromXYZ,
  hexToRgba,
  getBlurContainMaxScale,
  getWipeClipPath,
} from '../../lib/controllerHelpers';

function getImageSrc(p: PlayoutPayload): string {
  return (p.resolvedSrc ?? p.src) || '';
}

const STORAGE_KEY_BUFFER_MS = 'frameflow_playout_buffer_ms';
const DEFAULT_BUFFER_MS = 300;
const MIN_BUFFER_MS = 0;
const MAX_BUFFER_MS = 2000;

const STORAGE_KEY_SHOW_PROGRESS_BAR = 'frameflow_playout_show_progress_bar';

function getStoredBufferMs(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_BUFFER_MS;
  const v = localStorage.getItem(STORAGE_KEY_BUFFER_MS);
  if (v == null) return DEFAULT_BUFFER_MS;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= MIN_BUFFER_MS && n <= MAX_BUFFER_MS ? n : DEFAULT_BUFFER_MS;
}

function getStoredShowProgressBar(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const v = localStorage.getItem(STORAGE_KEY_SHOW_PROGRESS_BAR);
  if (v == null) return false;
  return v === '1' || v === 'true';
}

export function Stage() {
  const [bufferMs, setBufferMs] = useState(getStoredBufferMs);
  const bufferMsRef = useRef(bufferMs);
  bufferMsRef.current = bufferMs;
  const [showProgressBar, setShowProgressBar] = useState(getStoredShowProgressBar);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [payload, setPayload] = useState<PlayoutPayload | null>(null);
  const payloadRef = useRef<PlayoutPayload | null>(null);
  /** Increments on cut or on crossfade commit so the layer gets a new key. */
  const [playKey, setPlayKey] = useState(0);
  /** When set, we're in a fade transition: outgoing (payload) + incoming (nextPayload). */
  const [nextPayload, setNextPayload] = useState<PlayoutPayload | null>(null);
  /** When true, solo view uses main layer (kbRefNext); when false, uses current layer (kbRef). Set false on cut, true on crossfade commit so outgoing layer never changes structure and no jump. */
  const [useMainLayerForSolo, setUseMainLayerForSolo] = useState(false);
  const [crossfadeOutOpacity, setCrossfadeOutOpacity] = useState(1);
  const [crossfadeInOpacity, setCrossfadeInOpacity] = useState(0);
  const [crossfadeDuration, setCrossfadeDuration] = useState(0.8);
  const crossfadeDurationRef = useRef(0.8);
  const crossfadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 'fade' = opacity crossfade; 'wipe' = clip-path wipe; 'dip' = dip to color (CSS animations). */
  const [crossfadeTransitionKind, setCrossfadeTransitionKind] = useState<'fade' | 'wipe' | 'dip'>('fade');
  const [wipeRevealPct, setWipeRevealPct] = useState(100);
  const [wipeDirection, setWipeDirection] = useState<WipeDirection>('left');
  const [dipColor, setDipColor] = useState('#000000');
  const wipeRafRef = useRef<number | null>(null);
  const wipeCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dipCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const [fadeTransition, setFadeTransition] = useState<string>('none');
  const [contentOpacity, setContentOpacity] = useState(1);
  const [contentTransition, setContentTransition] = useState<string>('none');
  const [connectionAccepted, setConnectionAccepted] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [lowerThirdVis, setLowerThirdVis] = useState(false);
  const kbRef = useRef<HTMLDivElement>(null);
  const kbRefNext = useRef<HTMLDivElement>(null);
  const splitKbRef = useRef<HTMLDivElement>(null);
  const splitKbRefNext = useRef<HTMLDivElement>(null);
  const blurKbRef = useRef<HTMLDivElement>(null);
  const blurKbRefNext = useRef<HTMLDivElement>(null);
  const [blurPayloadImageSize, setBlurPayloadImageSize] = useState<{ w: number; h: number } | null>(null);
  const [blurDisplayImageSize, setBlurDisplayImageSize] = useState<{ w: number; h: number } | null>(null);
  const lastMainPayloadRef = useRef<PlayoutPayload | null>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const eocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progRafRef = useRef<number | null>(null);
  /** Buffer: pending play to apply after bufferMs (and after incoming image ready for fade). */
  const pendingApplyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPlayRef = useRef<{ p: PlayoutPayload; doFade: boolean; doWipe?: boolean; doDip?: boolean } | null>(null);
  const bufferPassedRef = useRef(false);
  const incomingImageReadyRef = useRef(false);
  const preloadImageRef = useRef<HTMLImageElement | null>(null);
  const applyPlayRef = useRef<((p: PlayoutPayload, doFade: boolean, doWipe?: boolean, doDip?: boolean) => void) | null>(null);
  const applyStopRef = useRef<(() => void) | null>(null);
  /** Ref for message handler so Connect (Realtime) can forward messages. */
  const messageHandlerRef = useRef<((d: { type: string; [key: string]: unknown }) => void) | null>(null);
  /** Realtime send + unsubscribe when connected via Supabase. */
  const realtimeSendRef = useRef<((msg: { type: string; [key: string]: unknown }) => void) | null>(null);
  const realtimeUnsubscribeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  const clearTimers = useCallback(() => {
    if (eocTimerRef.current) {
      clearTimeout(eocTimerRef.current);
      eocTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (progRafRef.current != null) {
      cancelAnimationFrame(progRafRef.current);
      progRafRef.current = null;
    }
    if (crossfadeTimeoutRef.current) {
      clearTimeout(crossfadeTimeoutRef.current);
      crossfadeTimeoutRef.current = null;
    }
    if (wipeRafRef.current != null) {
      cancelAnimationFrame(wipeRafRef.current);
      wipeRafRef.current = null;
    }
    if (wipeCommitTimeoutRef.current != null) {
      clearTimeout(wipeCommitTimeoutRef.current);
      wipeCommitTimeoutRef.current = null;
    }
    if (dipCommitTimeoutRef.current != null) {
      clearTimeout(dipCommitTimeoutRef.current);
      dipCommitTimeoutRef.current = null;
    }
  }, []);

  // Subscribe to playout channel and window messages
  useEffect(() => {
    const applyPlay = (p: PlayoutPayload, doFade: boolean, doWipe?: boolean, doDip?: boolean) => {
      if (eocTimerRef.current) {
        clearTimeout(eocTimerRef.current);
        eocTimerRef.current = null;
      }
      if (crossfadeTimeoutRef.current) {
        clearTimeout(crossfadeTimeoutRef.current);
        crossfadeTimeoutRef.current = null;
      }
      if (doWipe) {
        setNextPayload(p);
        setCrossfadeTransitionKind('wipe');
        setWipeDirection((p.wipeDirection as WipeDirection) ?? 'left');
        setWipeRevealPct(100);
        setCrossfadeOutOpacity(1);
        setCrossfadeInOpacity(1);
        crossfadeDurationRef.current = (p.transDuration ?? 0) as number;
        setCrossfadeDuration((p.transDuration ?? 0) as number);
        setLowerThirdVis(false);
      } else if (doDip) {
        setNextPayload(p);
        setCrossfadeTransitionKind('dip');
        setDipColor((p.dipColor as string) ?? '#000000');
        setCrossfadeOutOpacity(1);
        setCrossfadeInOpacity(1);
        crossfadeDurationRef.current = (p.transDuration ?? 0) as number;
        setCrossfadeDuration((p.transDuration ?? 0) as number);
        setLowerThirdVis(false);
      } else if (doFade) {
        setNextPayload(p);
        setCrossfadeTransitionKind('fade');
        setCrossfadeOutOpacity(1);
        setCrossfadeInOpacity(0);
        crossfadeDurationRef.current = (p.transDuration ?? 0) as number;
        setCrossfadeDuration((p.transDuration ?? 0) as number);
        setLowerThirdVis(false);
      } else {
        setNextPayload(null);
        setCrossfadeTransitionKind('fade');
        setUseMainLayerForSolo(false);
        setPlayKey((k) => k + 1);
        setPayload(p);
        setLowerThirdVis(false);
        const fadeTo = (p.fadeTo as 'black' | 'transparent') ?? 'black';
        const rawFadeIn = (p.fadeIn ?? 0) as number;
        const dur = rawFadeIn > 0 ? Math.max(rawFadeIn, 1) : 0;
        if (dur > 0 && fadeTo === 'transparent') {
          setContentTransition('none');
          setContentOpacity(0);
          setFadeOpacity(0);
          setTimeout(() => {
            setContentTransition(`opacity ${dur}s ease`);
            setContentOpacity(1);
          }, 50);
        } else if (dur > 0 && fadeTo === 'black') {
          setFadeTransition('none');
          setFadeOpacity(1);
          setContentOpacity(1);
          setTimeout(() => {
            setFadeTransition(`opacity ${dur}s ease`);
            setFadeOpacity(0);
          }, 50);
        } else {
          setContentTransition('none');
          setFadeOpacity(0);
          setContentOpacity(1);
        }
      }
    };
    const applyStop = () => {
      clearTimers();
      setPayload(null);
      setNextPayload(null);
      setUseMainLayerForSolo(false);
      setCrossfadeOutOpacity(1);
      setCrossfadeInOpacity(0);
      setCrossfadeTransitionKind('fade');
      setWipeRevealPct(100);
      setDipColor('#000000');
      setFadeOpacity(0);
      setContentOpacity(1);
    };
    applyPlayRef.current = applyPlay;
    applyStopRef.current = applyStop;

    const tryApplyPending = () => {
      const pending = pendingPlayRef.current;
      if (!pending) return;
      const needsPreload = pending.doFade || pending.doWipe || pending.doDip;
      if (needsPreload && !incomingImageReadyRef.current) return;
      if (!bufferPassedRef.current) return;
      pendingPlayRef.current = null;
      applyPlayRef.current?.(pending.p, pending.doFade, pending.doWipe, pending.doDip);
    };

    const handle = (d: { type: string; duration?: number; partial?: boolean; [key: string]: unknown }) => {
      if (d.type === 'connectionAccepted') {
        setConnectionAccepted(true);
        setCodeError('');
      }
      if (d.type === 'play') {
        const p = d as PlayoutPayload;
        const current = payloadRef.current;
        const transType = (p.transitionType as string) ?? 'cut';
        const transDur = (p.transDuration ?? 0) as number;
        const doFade = current != null && transType === 'fade' && transDur > 0;
        const doWipe = current != null && transType === 'wipe' && transDur > 0;
        const doDip = current != null && transType === 'dip' && transDur > 0;
        const groupAdvance = (p.groupAdvance as boolean) === true;
        const bufferMs = groupAdvance ? 0 : bufferMsRef.current;

        if (pendingApplyTimeoutRef.current) {
          clearTimeout(pendingApplyTimeoutRef.current);
          pendingApplyTimeoutRef.current = null;
        }
        preloadImageRef.current = null;
        pendingPlayRef.current = { p, doFade, doWipe, doDip };
        bufferPassedRef.current = false;
        incomingImageReadyRef.current = !doFade && !doWipe && !doDip;

        if (doFade || doWipe || doDip) {
          const src = getImageSrc(p);
          if (src) {
            const img = new Image();
            preloadImageRef.current = img;
            img.onload = () => {
              incomingImageReadyRef.current = true;
              preloadImageRef.current = null;
              tryApplyPending();
            };
            img.onerror = () => {
              incomingImageReadyRef.current = true;
              preloadImageRef.current = null;
              tryApplyPending();
            };
            img.src = src;
          } else {
            incomingImageReadyRef.current = true;
          }
        }

        pendingApplyTimeoutRef.current = setTimeout(() => {
          pendingApplyTimeoutRef.current = null;
          bufferPassedRef.current = true;
          tryApplyPending();
        }, bufferMs);
      }
      if (d.type === 'stop') {
        if (pendingApplyTimeoutRef.current) {
          clearTimeout(pendingApplyTimeoutRef.current);
          pendingApplyTimeoutRef.current = null;
        }
        pendingPlayRef.current = null;
        preloadImageRef.current = null;
        pendingApplyTimeoutRef.current = setTimeout(() => {
          pendingApplyTimeoutRef.current = null;
          applyStopRef.current?.();
        }, bufferMsRef.current);
      }
      if (d.type === 'fadeOut') {
        const dur = d.duration ?? 1;
        const toTransparent = (d.fadeTo as string) === 'transparent';
        if (toTransparent) {
          setContentTransition(`opacity ${dur}s ease`);
          setContentOpacity(0);
          if (!d.partial) {
            fadeTimerRef.current = setTimeout(() => {
              setContentTransition('none');
              clearTimers();
              setPayload(null);
              setContentOpacity(1);
              fadeTimerRef.current = null;
            }, dur * 1000 + 100);
          }
        } else {
          setFadeTransition(`opacity ${dur}s ease`);
          setTimeout(() => setFadeOpacity(1), 50);
          if (!d.partial) {
            fadeTimerRef.current = setTimeout(() => {
              setFadeTransition('none');
              clearTimers();
              setPayload(null);
              setFadeOpacity(0);
              fadeTimerRef.current = null;
            }, dur * 1000 + 100);
          }
        }
      }
    };
    messageHandlerRef.current = handle;
    const unsubCh = subscribeToPlayout(handle);
    const unsubWin = subscribeToWindowMessage(handle);
    return () => {
      messageHandlerRef.current = null;
      unsubCh();
      unsubWin();
      realtimeUnsubscribeRef.current?.();
      realtimeUnsubscribeRef.current = null;
      realtimeSendRef.current = null;
      clearTimers();
      if (pendingApplyTimeoutRef.current) {
        clearTimeout(pendingApplyTimeoutRef.current);
        pendingApplyTimeoutRef.current = null;
      }
      pendingPlayRef.current = null;
    };
  }, [clearTimers]);

  // Fade transition: when nextPayload is set and kind is fade, run opacity crossfade then commit
  useEffect(() => {
    if (!nextPayload || crossfadeTransitionKind !== 'fade') return;
    const durMs = crossfadeDurationRef.current * 1000;
    const START_DELAY_MS = 80;
    const COMMIT_EXTRA_MS = 150;

    const tStart = setTimeout(() => {
      setCrossfadeOutOpacity(0);
      setCrossfadeInOpacity(1);
    }, START_DELAY_MS);

    crossfadeTimeoutRef.current = setTimeout(() => {
      setPayload(nextPayload);
      setNextPayload(null);
      setUseMainLayerForSolo(true);
      setCrossfadeOutOpacity(1);
      setCrossfadeInOpacity(0);
      setCrossfadeTransitionKind('fade');
      setPlayKey((k) => k + 1);
      crossfadeTimeoutRef.current = null;
    }, durMs + COMMIT_EXTRA_MS);

    return () => {
      clearTimeout(tStart);
      if (crossfadeTimeoutRef.current) {
        clearTimeout(crossfadeTimeoutRef.current);
        crossfadeTimeoutRef.current = null;
      }
    };
  }, [nextPayload, crossfadeTransitionKind]);

  // Wipe transition: when nextPayload is set and kind is wipe, animate clip-path then commit
  useEffect(() => {
    if (!nextPayload || crossfadeTransitionKind !== 'wipe') return;
    const durationSec = crossfadeDurationRef.current;
    const COMMIT_EXTRA_MS = 150;
    const start = performance.now();
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = (now - start) / 1000;
      const pct = Math.max(0, Math.min(100, 100 - (elapsed / durationSec) * 100));
      setWipeRevealPct(pct);
      if (pct > 0) {
        wipeRafRef.current = requestAnimationFrame(tick);
      } else {
        wipeRafRef.current = null;
        wipeCommitTimeoutRef.current = setTimeout(() => {
          wipeCommitTimeoutRef.current = null;
          if (cancelled) return;
          setPayload(nextPayload);
          setNextPayload(null);
          setUseMainLayerForSolo(true);
          setCrossfadeOutOpacity(1);
          setCrossfadeInOpacity(0);
          setCrossfadeTransitionKind('fade');
          setWipeRevealPct(100);
          setPlayKey((k) => k + 1);
        }, COMMIT_EXTRA_MS);
      }
    };
    wipeRafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (wipeRafRef.current != null) {
        cancelAnimationFrame(wipeRafRef.current);
        wipeRafRef.current = null;
      }
      if (wipeCommitTimeoutRef.current != null) {
        clearTimeout(wipeCommitTimeoutRef.current);
        wipeCommitTimeoutRef.current = null;
      }
    };
  }, [nextPayload, crossfadeTransitionKind]);

  // Dip transition: CSS animations run; just commit after duration
  useEffect(() => {
    if (!nextPayload || crossfadeTransitionKind !== 'dip') return;
    const durMs = crossfadeDurationRef.current * 1000;
    const COMMIT_EXTRA_MS = 150;

    dipCommitTimeoutRef.current = setTimeout(() => {
      dipCommitTimeoutRef.current = null;
      setPayload(nextPayload);
      setNextPayload(null);
      setUseMainLayerForSolo(true);
      setCrossfadeOutOpacity(1);
      setCrossfadeInOpacity(0);
      setCrossfadeTransitionKind('fade');
      setDipColor('#000000');
      setPlayKey((k) => k + 1);
    }, durMs + COMMIT_EXTRA_MS);

    return () => {
      if (dipCommitTimeoutRef.current != null) {
        clearTimeout(dipCommitTimeoutRef.current);
        dipCommitTimeoutRef.current = null;
      }
    };
  }, [nextPayload, crossfadeTransitionKind]);

  // EOC timers when payload is set (skip during crossfade)
  useEffect(() => {
    if (!payload || nextPayload) return;
    const effectiveHold = payload.holdDuration ?? 10;
    if (payload.eoc === 'fade') {
      const fadeOutDur = Math.max(payload.fadeOut ?? 0, 1);
      const delay = Math.max(0, effectiveHold * 1000 - fadeOutDur * 1000);
      const fadeTo = (payload.fadeTo as 'black' | 'transparent') ?? 'black';
      eocTimerRef.current = setTimeout(() => {
        if (fadeTo === 'transparent') {
          setContentTransition(`opacity ${fadeOutDur}s ease`);
          setContentOpacity(0);
          fadeTimerRef.current = setTimeout(() => {
            setContentTransition('none');
            setPayload(null);
            setContentOpacity(1);
            fadeTimerRef.current = null;
          }, fadeOutDur * 1000 + 100);
        } else {
          setFadeTransition(`opacity ${fadeOutDur}s ease`);
          setTimeout(() => {
            setFadeOpacity(1);
          }, 50);
          fadeTimerRef.current = setTimeout(() => {
            setFadeTransition('none');
            setPayload(null);
            setFadeOpacity(0);
            fadeTimerRef.current = null;
          }, fadeOutDur * 1000 + 100);
        }
      }, delay);
    } else if (payload.eoc === 'clear') {
      eocTimerRef.current = setTimeout(() => {
        setPayload(null);
        eocTimerRef.current = null;
      }, effectiveHold * 1000);
    }
    return () => {
      if (eocTimerRef.current) clearTimeout(eocTimerRef.current);
      eocTimerRef.current = null;
    };
  }, [payload?.eoc, payload?.holdDuration, payload?.fadeOut, payload?.fadeTo, nextPayload]);

  // Lower-third visible after delay
  useEffect(() => {
    if (!payload || !payload.captionOn || payload.mode === 'split') return;
    const t = setTimeout(() => setLowerThirdVis(true), 1200);
    return () => clearTimeout(t);
  }, [payload?.captionOn, payload?.mode, payload?.captionTitle]);

  // Ken Burns for current/payload layer. Split/blurbg: frame fixed, KB on image inside.
  useLayoutEffect(() => {
    const el = (payload?.mode === 'split') ? splitKbRef.current : (payload?.mode === 'blurbg') ? blurKbRef.current : kbRef.current;
    if (!el || !payload) return;
    if (nextPayload === null && useMainLayerForSolo) return;
    // During crossfade, do not touch the outgoing layer — leave it at its current animation position so it doesn't jump
    if (nextPayload != null) return;
    const p = payload;
    const scale = p.kbScale ?? 1;
    const dur = p.kbDur ?? 10;
    el.style.animation = '';
    el.style.transform = '';
    el.style.animationDelay = '';
    if (p.kbAnim === 'custom') {
      el.style.setProperty('--ks', '1');
      if (
        p.kbStartCx != null && p.kbStartCy != null && p.kbStartZ != null &&
        p.kbEndCx != null && p.kbEndCy != null && p.kbEndZ != null
      ) {
        applyCustomKBKeyframesFromXYZ(
          el,
          { cx: p.kbStartCx, cy: p.kbStartCy, z: p.kbStartZ },
          { cx: p.kbEndCx, cy: p.kbEndCy, z: p.kbEndZ },
          dur,
          scale
        );
      } else if (p.kbCustomStart && p.kbCustomEnd) {
        applyCustomKBKeyframes(el, p.kbCustomStart, p.kbCustomEnd, dur, scale);
      }
    } else {
      let effectiveScale = scale;
      if (p.mode === 'blurbg' && blurPayloadImageSize && p.modeOpts && typeof p.modeOpts === 'object') {
        const blurbg = (p.modeOpts as Record<string, unknown>);
        const fillFrame = blurbg.fillFrame !== false;
        if (!fillFrame) {
          const fw = (blurbg.frameWidth as number) ?? 70;
          const fh = (blurbg.frameHeight as number) ?? 70;
          const frameAspect = (fw / fh) * (16 / 9);
          const imageAspect = blurPayloadImageSize.w / blurPayloadImageSize.h;
          effectiveScale = Math.min(scale, getBlurContainMaxScale(frameAspect, imageAspect));
        }
      }
      el.style.setProperty('--ks', String(effectiveScale));
      const animName = getKBAnimationName(p.kbAnim);
      el.style.animation = `${animName} ${dur}s ease-in-out forwards`;
    }
  }, [payload, nextPayload, useMainLayerForSolo, blurPayloadImageSize]);

  // Ken Burns for main layer. Split/blurbg: frame fixed, KB on image inside.
  useLayoutEffect(() => {
    const p = nextPayload ?? payload;
    const el = (p?.mode === 'split') ? splitKbRefNext.current : (p?.mode === 'blurbg') ? blurKbRefNext.current : kbRefNext.current;
    if (!el || !p) return;
    if (!nextPayload && !useMainLayerForSolo) return;
    if (p === lastMainPayloadRef.current) return;
    lastMainPayloadRef.current = p;
    const scale = p.kbScale ?? 1;
    const dur = p.kbDur ?? 10;
    el.style.animation = '';
    el.style.transform = '';
    el.style.animationDelay = '';
    if (p.kbAnim === 'custom') {
      el.style.setProperty('--ks', '1');
      if (
        p.kbStartCx != null && p.kbStartCy != null && p.kbStartZ != null &&
        p.kbEndCx != null && p.kbEndCy != null && p.kbEndZ != null
      ) {
        applyCustomKBKeyframesFromXYZ(
          el,
          { cx: p.kbStartCx, cy: p.kbStartCy, z: p.kbStartZ },
          { cx: p.kbEndCx, cy: p.kbEndCy, z: p.kbEndZ },
          dur,
          scale
        );
      } else if (p.kbCustomStart && p.kbCustomEnd) {
        applyCustomKBKeyframes(el, p.kbCustomStart, p.kbCustomEnd, dur, scale);
      }
    } else {
      let effectiveScale = scale;
      if (p.mode === 'blurbg' && blurDisplayImageSize && p.modeOpts && typeof p.modeOpts === 'object') {
        const blurbg = (p.modeOpts as Record<string, unknown>);
        const fillFrame = blurbg.fillFrame !== false;
        if (!fillFrame) {
          const fw = (blurbg.frameWidth as number) ?? 70;
          const fh = (blurbg.frameHeight as number) ?? 70;
          const frameAspect = (fw / fh) * (16 / 9);
          const imageAspect = blurDisplayImageSize.w / blurDisplayImageSize.h;
          effectiveScale = Math.min(scale, getBlurContainMaxScale(frameAspect, imageAspect));
        }
      }
      el.style.setProperty('--ks', String(effectiveScale));
      const animName = getKBAnimationName(p.kbAnim);
      el.style.animation = `${animName} ${dur}s ease-in-out forwards`;
    }
  }, [payload, nextPayload, useMainLayerForSolo, blurDisplayImageSize]);

  // Progress bar (only when setting enabled; off by default, mainly for testing)
  useEffect(() => {
    if (!showProgressBar || !payload || !progRef.current || nextPayload) return;
    const effectiveHold = payload.holdDuration ?? 10;
    const start = Date.now();
    const dur = effectiveHold * 1000;
    const tick = () => {
      const pct = Math.min(((Date.now() - start) / dur) * 100, 100);
      if (progRef.current) progRef.current.style.width = `${pct}%`;
      if (pct < 100) progRafRef.current = requestAnimationFrame(tick);
    };
    progRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (progRafRef.current != null) cancelAnimationFrame(progRafRef.current);
    };
  }, [showProgressBar, payload, nextPayload]);

  useEffect(() => { setBlurPayloadImageSize(null); }, [payload, payload?.src]);
  useEffect(() => { setBlurDisplayImageSize(null); }, [payload, nextPayload, nextPayload?.src, payload?.src]);

  const imgSrc = payload ? getImageSrc(payload) : '';
  const mo = payload?.modeOpts ?? {};
  const cs = payload?.captionStyle ?? {};
  const objFit = (mo.objectFit as string) ?? 'cover';
  const vignette = (mo as { vignette?: boolean }).vignette ?? false;
  const blurAmount = (mo as { blurAmount?: number }).blurAmount ?? 28;
  const bgBrightness = (mo as { bgBrightness?: number }).bgBrightness ?? 0.45;
  const photoSide = (mo as { splitImageSide?: string }).splitImageSide ?? 'left';
  const textAlign = (mo as { splitTextAlign?: string }).splitTextAlign ?? 'left';
  const isCenter = photoSide === 'center';
  const centerW = (mo as { splitCenterWidth?: number }).splitCenterWidth ?? 40;
  const centerH = (mo as { splitCenterHeight?: number }).splitCenterHeight ?? 45;
  const splitImgWidth = (mo as { splitImgWidth?: number }).splitImgWidth ?? 55;
  const splitShowBorder = (mo as { split?: { showBorder?: boolean } }).split?.showBorder ?? false;
  const splitBorderColor = (mo as { split?: { borderColor?: string } }).split?.borderColor ?? '#ffffff';
  const splitBorderWidth = (mo as { split?: { borderWidth?: number } }).split?.borderWidth ?? 2;
  const splitBorderStyle = splitShowBorder ? { border: `${splitBorderWidth}px solid ${splitBorderColor}` } : {};

  /** Main layer shows incoming during crossfade, then solo; same key after commit so it doesn't remount/jump */
  const displayPayload = nextPayload ?? payload;
  const imgSrcDisplay = displayPayload ? getImageSrc(displayPayload) : '';
  const moDisplay = displayPayload?.modeOpts ?? {};
  const csDisplay = displayPayload?.captionStyle ?? {};

  const handleConnect = useCallback(() => {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      setCodeError('Enter the code from the controller');
      return;
    }
    setCodeError('');
    getPlayoutChannel().postMessage({ type: 'connect', code });
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'connect', code }, '*');
    }
    connectToPlayoutChannelAsPlayout(
      code,
      ((msg: { type: string; [key: string]: unknown }) => messageHandlerRef.current?.(msg as PlayoutMessage)) as (msg: { type: string; [key: string]: unknown }) => void
    )
      .then(({ send, unsubscribe }) => {
        realtimeSendRef.current = send;
        realtimeUnsubscribeRef.current = unsubscribe;
      })
      .catch((err) => {
        if (err?.message !== 'Supabase not configured') {
          setCodeError(err instanceof Error ? err.message : 'Connection failed');
        }
      });
  }, [codeInput]);

  useEffect(() => {
    if (!connectionAccepted) return;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    return () => {
      document.body.style.background = '';
      document.documentElement.style.background = '';
    };
  }, [connectionAccepted]);

  // Low-egress heartbeat so controller knows playout is still there; no constant ping from controller
  useEffect(() => {
    if (!connectionAccepted) return;
    const ch = getPlayoutChannel();
    const id = setInterval(() => {
      ch.postMessage({ type: 'heartbeat' });
      realtimeSendRef.current?.({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [connectionAccepted]);

  // When user closes the stage window/tab, notify controller so it can show disconnected immediately
  useEffect(() => {
    if (!connectionAccepted) return;
    const notifyDisconnect = () => {
      getPlayoutChannel().postMessage({ type: 'disconnect' });
      try {
        realtimeSendRef.current?.({ type: 'disconnect' });
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', notifyDisconnect);
    return () => window.removeEventListener('beforeunload', notifyDisconnect);
  }, [connectionAccepted]);

  return (
    <div
      id="stage"
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100vw',
        height: '100vh',
        background: connectionAccepted ? 'transparent' : '#0a0a0a',
        cursor: 'default',
      }}
    >
      {/* Code entry (before connection) */}
      {!connectionAccepted && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: '#0a0a0a',
            zIndex: 200,
            padding: 24,
          }}
        >
          {/* Settings cog — top-right, only before connect */}
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            title="Output settings"
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: settingsOpen ? '#222' : 'transparent',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#888',
              cursor: 'pointer',
              fontSize: 18,
            }}
          >
            ⚙
          </button>
          {settingsOpen && (
            <div
              style={{
                position: 'absolute',
                top: 64,
                right: 16,
                width: 220,
                padding: 14,
                background: '#111',
                border: '1px solid #333',
                borderRadius: 8,
                zIndex: 201,
              }}
            >
              <div style={{ fontFamily: "'DM Mono'", fontSize: 10, letterSpacing: 2, color: '#666', marginBottom: 10 }}>OUTPUT SETTINGS</div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontFamily: "'DM Mono'", fontSize: 11, color: '#999' }}>
                <span>Buffer (ms)</span>
                <input
                  type="number"
                  min={MIN_BUFFER_MS}
                  max={MAX_BUFFER_MS}
                  step={50}
                  value={bufferMs}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isFinite(v)) return;
                    const clamped = Math.min(MAX_BUFFER_MS, Math.max(MIN_BUFFER_MS, v));
                    setBufferMs(clamped);
                    try {
                      localStorage.setItem(STORAGE_KEY_BUFFER_MS, String(clamped));
                    } catch {
                      // ignore
                    }
                  }}
                  style={{
                    width: 72,
                    padding: '6px 8px',
                    fontFamily: "'DM Mono'",
                    fontSize: 12,
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: 4,
                    color: '#fff',
                    outline: 'none',
                  }}
                />
              </label>
              <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: '#555', marginTop: 8 }}>
                0 = no delay. Higher = smoother, more lag.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontFamily: "'DM Mono'", fontSize: 11, color: '#999' }}>
                <input
                  type="checkbox"
                  checked={showProgressBar}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setShowProgressBar(v);
                    try {
                      localStorage.setItem(STORAGE_KEY_SHOW_PROGRESS_BAR, v ? '1' : '0');
                    } catch {
                      // ignore
                    }
                  }}
                  style={{ accentColor: 'var(--accent,#d4ff47)' }}
                />
                <span>Show progress bar</span>
              </label>
              <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: '#555', marginTop: 4 }}>
                Off by default. Turn on for testing (shows hold-time fill on output).
              </div>
            </div>
          )}

          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 'clamp(24px,4vw,42px)', letterSpacing: 6, color: 'var(--accent,#d4ff47)' }}>FRAMEFLOW PLAYOUT</div>
          <div style={{ fontFamily: "'DM Mono'", fontSize: 12, color: '#666', letterSpacing: 2 }}>Enter connection code from controller</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              value={codeInput}
              onChange={(e) => { setCodeInput(e.target.value.toUpperCase().slice(0, 6)); setCodeError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              placeholder="e.g. AB12XY"
              maxLength={6}
              style={{
                width: 140,
                padding: '10px 14px',
                fontFamily: "'DM Mono'",
                fontSize: 18,
                letterSpacing: 4,
                textAlign: 'center',
                background: '#1a1a1a',
                border: `1px solid ${codeError ? '#c44' : '#333'}`,
                borderRadius: 4,
                color: '#fff',
                outline: 'none',
              }}
            />
            {codeError && <div style={{ fontSize: 11, color: '#c44' }}>{codeError}</div>}
            <button
              type="button"
              onClick={handleConnect}
              style={{
                padding: '8px 20px',
                fontFamily: "'DM Mono'",
                fontSize: 11,
                letterSpacing: 2,
                background: 'var(--accent,#d4ff47)',
                color: '#000',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              CONNECT
            </button>
          </div>
        </div>
      )}

      {/* 16:9 viewport when connected — centered, scales when window is resized */}
      {connectionAccepted && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
          }}
        >
          <div
            style={{
              width: 'min(100vw, 100vh * 16 / 9)',
              height: 'min(100vh, 100vw * 9 / 16)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
      {/* Fade overlay — above content so fades are visible */}
      <div
        id="fade-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          background: '#000',
          zIndex: 1000,
          pointerEvents: 'none',
          opacity: fadeOpacity,
          transition: fadeTransition,
        }}
      />

      {/* Dip-to-color layer: behind content during dip transition */}
      {nextPayload && crossfadeTransitionKind === 'dip' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 9,
            pointerEvents: 'none',
            background: dipColor,
          }}
        />
      )}

      {/* Current/payload layer: when solo and !useMainLayerForSolo this is the only layer; when crossfade this is outgoing. Same key+structure so no jump at fade start. */}
      {payload && imgSrc && (nextPayload || !useMainLayerForSolo) && (
        <div
          key={playKey}
          className={`play-layer ${nextPayload && crossfadeTransitionKind === 'dip' ? 'trans-dip-out' : ''}`}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none',
            ...(nextPayload && crossfadeTransitionKind === 'dip' ? { ['--td' as string]: `${crossfadeDuration}s` } : {}),
            ...(crossfadeTransitionKind !== 'dip' ? {
              opacity: nextPayload ? crossfadeOutOpacity : contentOpacity,
              transition: nextPayload ? `opacity ${crossfadeDuration}s ease` : contentTransition,
            } : {}),
          }}
        >
          {payload.mode === 'fullscreen' && (
            <>
              <div className="kb-layer" ref={kbRef}>
                <img className="fill" src={imgSrc} alt="" decoding="async" style={{ objectFit: objFit as 'cover' | 'contain' }} />
              </div>
              {vignette && <div className="vignette" />}
            </>
          )}
          {payload.mode === 'blurbg' && (() => {
            const blurbg = (payload.modeOpts as Record<string, unknown>) || {};
            const fw = (blurbg.frameWidth as number) ?? 70;
            const fh = (blurbg.frameHeight as number) ?? 70;
            const fillFrame = blurbg.fillFrame !== false;
            const showBorder = (blurbg.showBorder as boolean) ?? false;
            const borderColor = (blurbg.borderColor as string) ?? '#ffffff';
            const borderWidth = (blurbg.borderWidth as number) ?? 2;
            const frameAspect = (fw / fh) * (16 / 9);
            const imageAspect = blurPayloadImageSize ? blurPayloadImageSize.w / blurPayloadImageSize.h : 16 / 9;
            const fillScale = fillFrame ? getBlurContainMaxScale(frameAspect, imageAspect) : 1;
            const frameStyle: React.CSSProperties = {
              left: '50%',
              top: '50%',
              width: `${fw}%`,
              height: `${fh}%`,
              transform: 'translate(-50%, -50%)',
              border: showBorder ? `${borderWidth}px solid ${borderColor}` : 'none',
            };
            const fillWrapStyle: React.CSSProperties = {
              transform: `scale(${fillScale})`,
              transformOrigin: '50% 50%',
            };
            return (
              <div className="kb-layer">
                <div className="blur-bg" style={{ backgroundImage: `url(${imgSrc})`, filter: `blur(${blurAmount}px) brightness(${bgBrightness}) saturate(1.4)` }} />
                <div className="blur-frame" style={frameStyle}>
                  <div className="blur-fill-wrap" style={fillWrapStyle}>
                    <div className="blur-kb-inner" ref={blurKbRef}>
                      <img
                        src={imgSrc} alt="" decoding="async"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          if (img.naturalWidth && img.naturalHeight) setBlurPayloadImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          {payload.mode === 'split' && (
            <>
              <div className="kb-layer">
                <div className="split-bg-layer" style={{ backgroundImage: `url(${imgSrc})` }} />
                {payload.captionOn ? (
                  <div className={`split-content split-content--img-only ${photoSide === 'right' ? 'split-content--photo-right' : ''} ${isCenter ? 'split-content--photo-center' : ''}`} style={isCenter ? { ['--split-center-img-h' as string]: `${centerH}%` } : { ['--split-img-width' as string]: `${splitImgWidth}%` }}>
                    <div className={isCenter ? 'split-img-wrap split-img-wrap--center' : 'split-img-wrap'} style={{ ...(isCenter ? { width: `${centerW}%`, height: `${centerH}%` } : { width: `${splitImgWidth}%` }), ...splitBorderStyle }}>
                      <div className="split-kb-inner" ref={splitKbRef}>
                        <img src={imgSrc} alt="" decoding="async" style={{ objectFit: objFit as 'cover' | 'contain' }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="split-content split-content--full">
                    <div className="split-img-wrap split-img-wrap--full" style={splitBorderStyle}>
                      <div className="split-kb-inner" ref={splitKbRef}>
                        <img src={imgSrc} alt="" decoding="async" style={{ objectFit: objFit as 'cover' | 'contain' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {payload.captionOn && (
                <div
                  className={`split-text split-text--fixed split-text--h-${textAlign}`}
                  style={{
                    position: 'absolute',
                    ...(isCenter ? { top: `${centerH}%`, left: 0, right: 0, bottom: 0 } : photoSide === 'right' ? { left: 0, right: `${100 - splitImgWidth}%`, top: 0, bottom: 0 } : { left: `${splitImgWidth}%`, right: 0, top: 0, bottom: 0 }),
                    margin: 0,
                    transformOrigin: textAlign === 'center' ? 'top center' : textAlign === 'right' ? 'top right' : 'top left',
                    transform: `scale(${Math.max(0.5, Math.min(2, (cs as { textScale?: number }).textScale ?? 1))}) translateY(${-((cs as { offsetY?: number }).offsetY ?? 0)}px)`,
                  }}
                >
                  <div className="split-text-inner">
                    {payload.captionTag && <div className="split-tag" style={{ color: cs.accentColor ?? '#d4ff47' }}>{payload.captionTag}</div>}
                    <h2 style={{ color: cs.textColor ?? '#fff' }}>{payload.captionTitle || payload.name}</h2>
                    <p style={{ color: cs.textColor ?? '#fff' }}>{payload.captionSub || payload.subject || ''}</p>
                  </div>
                </div>
              )}
            </>
          )}
          {payload.captionOn && payload.mode !== 'split' && (
            <div className={`lower-third pos-${(cs.position as string) || 'bottom'} lt-justify-${(cs.justify as string) ?? 'left'} ${lowerThirdVis ? 'vis' : ''}`} style={{ background: `linear-gradient(transparent, ${hexToRgba((cs.bgColor as string) ?? '#000000', ((cs.bgOpacity as number) ?? 75) / 100)})` }}>
              <div className="lower-third-inner" style={{ transformOrigin: (cs.justify as string) === 'center' ? 'bottom center' : (cs.justify as string) === 'right' ? 'bottom right' : 'bottom left', transform: `scale(${Math.max(0.5, Math.min(2, (cs as { textScale?: number }).textScale ?? 1))}) translateY(${-((cs as { offsetY?: number }).offsetY ?? 0)}px)` }}>
                <div className="lt-tag" style={{ color: cs.accentColor ?? '#d4ff47' }}>{payload.captionTag || ''}</div>
                <div className="lt-title" style={{ color: cs.textColor ?? '#fff' }}>{payload.captionTitle || payload.name}</div>
                {payload.captionSub && <div className="lt-sub" style={{ color: cs.textColor ?? '#fff' }}>{payload.captionSub}</div>}
              </div>
            </div>
          )}
          {showProgressBar && !nextPayload && (
            <div className="prog-bar">
              <div ref={progRef} className="prog-fill" style={{ width: '0%' }} />
            </div>
          )}
        </div>
      )}
      {/* Main layer: incoming during crossfade, or solo after commit (useMainLayerForSolo); key stays playKey+1 → playKey on commit so no remount/jump */}
      {displayPayload && imgSrcDisplay && (nextPayload || useMainLayerForSolo) && (
        <div
          key={nextPayload ? playKey + 1 : playKey}
          className={`play-layer ${nextPayload && crossfadeTransitionKind === 'dip' ? 'trans-dip-in' : ''}`}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 11,
            pointerEvents: 'none',
            ...(nextPayload && crossfadeTransitionKind === 'dip' ? { ['--td' as string]: `${crossfadeDuration}s` } : {}),
            ...(crossfadeTransitionKind !== 'dip' ? {
              opacity: nextPayload && crossfadeTransitionKind === 'wipe' ? 1 : (nextPayload ? crossfadeInOpacity : contentOpacity),
              transition: nextPayload && crossfadeTransitionKind === 'wipe' ? 'none' : (nextPayload ? `opacity ${crossfadeDuration}s ease` : contentTransition),
              clipPath: nextPayload && crossfadeTransitionKind === 'wipe' ? getWipeClipPath(wipeDirection, wipeRevealPct) : undefined,
            } : {}),
          }}
        >
          {displayPayload.mode === 'fullscreen' && (
            <>
              <div className="kb-layer" ref={kbRefNext}>
                <img className="fill" src={imgSrcDisplay} alt="" decoding="async" style={{ objectFit: (moDisplay.objectFit as 'cover' | 'contain') ?? 'cover' }} />
              </div>
              {(moDisplay as { vignette?: boolean }).vignette && <div className="vignette" />}
            </>
          )}
          {displayPayload.mode === 'blurbg' && (() => {
            const blurbg = (displayPayload.modeOpts as Record<string, unknown>) || {};
            const fw = (blurbg.frameWidth as number) ?? 70;
            const fh = (blurbg.frameHeight as number) ?? 70;
            const fillFrame = blurbg.fillFrame !== false;
            const showBorder = (blurbg.showBorder as boolean) ?? false;
            const borderColor = (blurbg.borderColor as string) ?? '#ffffff';
            const borderWidth = (blurbg.borderWidth as number) ?? 2;
            const frameAspect = (fw / fh) * (16 / 9);
            const imageAspect = blurDisplayImageSize ? blurDisplayImageSize.w / blurDisplayImageSize.h : 16 / 9;
            const fillScale = fillFrame ? getBlurContainMaxScale(frameAspect, imageAspect) : 1;
            const frameStyle: React.CSSProperties = {
              left: '50%',
              top: '50%',
              width: `${fw}%`,
              height: `${fh}%`,
              transform: 'translate(-50%, -50%)',
              border: showBorder ? `${borderWidth}px solid ${borderColor}` : 'none',
            };
            const fillWrapStyle: React.CSSProperties = {
              transform: `scale(${fillScale})`,
              transformOrigin: '50% 50%',
            };
            return (
              <div className="kb-layer">
                <div className="blur-bg" style={{ backgroundImage: `url(${imgSrcDisplay})`, filter: `blur(${(moDisplay as { blurAmount?: number }).blurAmount ?? 28}px) brightness(${(moDisplay as { bgBrightness?: number }).bgBrightness ?? 0.45} saturate(1.4)` }} />
                <div className="blur-frame" style={frameStyle}>
                  <div className="blur-fill-wrap" style={fillWrapStyle}>
                    <div className="blur-kb-inner" ref={blurKbRefNext}>
                      <img
                        src={imgSrcDisplay} alt="" decoding="async"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          if (img.naturalWidth && img.naturalHeight) setBlurDisplayImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          {displayPayload.mode === 'split' && (() => {
            const splitD = moDisplay as { split?: { showBorder?: boolean; borderColor?: string; borderWidth?: number }; splitImageSide?: string; splitCenterWidth?: number; splitCenterHeight?: number; splitImgWidth?: number };
            const splitShowBorderD = splitD.split?.showBorder ?? false;
            const splitBorderStyleD = splitShowBorderD ? { border: `${splitD.split?.borderWidth ?? 2}px solid ${splitD.split?.borderColor ?? '#ffffff'}` } : {};
            return (
            <>
              <div className="kb-layer">
                <div className="split-bg-layer" style={{ backgroundImage: `url(${imgSrcDisplay})` }} />
                {displayPayload.captionOn ? (
                  <div className={`split-content split-content--img-only ${splitD.splitImageSide === 'right' ? 'split-content--photo-right' : ''} ${splitD.splitImageSide === 'center' ? 'split-content--photo-center' : ''}`} style={splitD.splitImageSide === 'center' ? { ['--split-center-img-h' as string]: `${splitD.splitCenterHeight ?? 45}%` } : { ['--split-img-width' as string]: `${splitD.splitImgWidth ?? 55}%` }}>
                    <div className={splitD.splitImageSide === 'center' ? 'split-img-wrap split-img-wrap--center' : 'split-img-wrap'} style={{ ...(splitD.splitImageSide === 'center' ? { width: `${splitD.splitCenterWidth ?? 40}%`, height: `${splitD.splitCenterHeight ?? 45}%` } : { width: `${splitD.splitImgWidth ?? 55}%` }), ...splitBorderStyleD }}>
                      <div className="split-kb-inner" ref={splitKbRefNext}>
                        <img src={imgSrcDisplay} alt="" decoding="async" style={{ objectFit: (moDisplay.objectFit as 'cover' | 'contain') ?? 'cover' }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="split-content split-content--full">
                    <div className="split-img-wrap split-img-wrap--full" style={splitBorderStyleD}>
                      <div className="split-kb-inner" ref={splitKbRefNext}>
                        <img src={imgSrcDisplay} alt="" decoding="async" style={{ objectFit: (moDisplay.objectFit as 'cover' | 'contain') ?? 'cover' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {displayPayload.captionOn && (
                <div
                  className={`split-text split-text--fixed split-text--h-${(moDisplay as { splitTextAlign?: string }).splitTextAlign ?? 'left'}`}
                  style={{
                    position: 'absolute',
                    ...((moDisplay as { splitImageSide?: string }).splitImageSide === 'center' ? { top: `${(moDisplay as { splitCenterHeight?: number }).splitCenterHeight ?? 45}%`, left: 0, right: 0, bottom: 0 } : (moDisplay as { splitImageSide?: string }).splitImageSide === 'right' ? { left: 0, right: `${100 - ((moDisplay as { splitImgWidth?: number }).splitImgWidth ?? 55)}%`, top: 0, bottom: 0 } : { left: `${(moDisplay as { splitImgWidth?: number }).splitImgWidth ?? 55}%`, right: 0, top: 0, bottom: 0 }),
                    margin: 0,
                    transformOrigin: ((moDisplay as { splitTextAlign?: string }).splitTextAlign ?? 'left') === 'center' ? 'top center' : ((moDisplay as { splitTextAlign?: string }).splitTextAlign ?? 'left') === 'right' ? 'top right' : 'top left',
                    transform: `scale(${Math.max(0.5, Math.min(2, (csDisplay as { textScale?: number }).textScale ?? 1))}) translateY(${-((csDisplay as { offsetY?: number }).offsetY ?? 0)}px)`,
                  }}
                >
                  <div className="split-text-inner">
                    {displayPayload.captionTag && <div className="split-tag" style={{ color: (csDisplay as { accentColor?: string }).accentColor ?? '#d4ff47' }}>{displayPayload.captionTag}</div>}
                    <h2 style={{ color: (csDisplay as { textColor?: string }).textColor ?? '#fff' }}>{displayPayload.captionTitle || displayPayload.name}</h2>
                    <p style={{ color: (csDisplay as { textColor?: string }).textColor ?? '#fff' }}>{displayPayload.captionSub || displayPayload.subject || ''}</p>
                  </div>
                </div>
              )}
            </>
            );
          })()}
          {displayPayload.captionOn && displayPayload.mode !== 'split' && (
            <div className={`lower-third pos-${((csDisplay as { position?: string }).position as string) || 'bottom'} lt-justify-${((csDisplay as { justify?: string }).justify as string) ?? 'left'}`} style={{ background: `linear-gradient(transparent, ${hexToRgba(((csDisplay as { bgColor?: string }).bgColor) ?? '#000000', (((csDisplay as { bgOpacity?: number }).bgOpacity) ?? 75) / 100)})` }}>
              <div className="lower-third-inner" style={{ transformOrigin: (csDisplay as { justify?: string }).justify === 'center' ? 'bottom center' : (csDisplay as { justify?: string }).justify === 'right' ? 'bottom right' : 'bottom left', transform: `scale(${Math.max(0.5, Math.min(2, (csDisplay as { textScale?: number }).textScale ?? 1))}) translateY(${-((csDisplay as { offsetY?: number }).offsetY ?? 0)}px)` }}>
                <div className="lt-tag" style={{ color: (csDisplay as { accentColor?: string }).accentColor ?? '#d4ff47' }}>{displayPayload.captionTag || ''}</div>
                <div className="lt-title" style={{ color: (csDisplay as { textColor?: string }).textColor ?? '#fff' }}>{displayPayload.captionTitle || displayPayload.name}</div>
                {displayPayload.captionSub && <div className="lt-sub" style={{ color: (csDisplay as { textColor?: string }).textColor ?? '#fff' }}>{displayPayload.captionSub}</div>}
              </div>
            </div>
          )}
          {showProgressBar && !nextPayload && (
            <div className="prog-bar">
              <div ref={progRef} className="prog-fill" style={{ width: '0%' }} />
            </div>
          )}
        </div>
      )}
          </div>
        </div>
      )}

    </div>
  );
}
