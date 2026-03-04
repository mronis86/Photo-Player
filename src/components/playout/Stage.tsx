/**
 * Playout stage — connection by code, then transparent full-screen program output.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { PlayoutPayload } from '../../lib/types';
import { subscribeToPlayout, subscribeToWindowMessage, getPlayoutChannel, HEARTBEAT_INTERVAL_MS } from '../../lib/playoutChannel';
import {
  getKBAnimationName,
  applyCustomKBKeyframes,
  applyCustomKBKeyframesFromXYZ,
  hexToRgba,
} from '../../lib/controllerHelpers';

function getImageSrc(p: PlayoutPayload): string {
  return (p.resolvedSrc ?? p.src) || '';
}

export function Stage() {
  const [payload, setPayload] = useState<PlayoutPayload | null>(null);
  const payloadRef = useRef<PlayoutPayload | null>(null);
  /** Increments on cut or on crossfade commit so the layer gets a new key. */
  const [playKey, setPlayKey] = useState(0);
  /** When set, we're in a fade transition: outgoing (payload) + incoming (nextPayload). */
  const [nextPayload, setNextPayload] = useState<PlayoutPayload | null>(null);
  const crossfadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const [fadeTransition, setFadeTransition] = useState<string>('none');
  const [contentOpacity, setContentOpacity] = useState(1);
  const [contentTransition, setContentTransition] = useState<string>('none');
  const [connectionAccepted, setConnectionAccepted] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [lowerThirdVis, setLowerThirdVis] = useState(false);
  const kbRef = useRef<HTMLDivElement>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const eocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progRafRef = useRef<number | null>(null);
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
  }, []);

  // Subscribe to playout channel and window messages
  useEffect(() => {
    const handle = (d: { type: string; duration?: number; partial?: boolean; [key: string]: unknown }) => {
      if (d.type === 'connectionAccepted') {
        setConnectionAccepted(true);
        setCodeError('');
      }
      if (d.type === 'play') {
        const p = d as PlayoutPayload;
        if (eocTimerRef.current) {
          clearTimeout(eocTimerRef.current);
          eocTimerRef.current = null;
        }
        if (crossfadeTimeoutRef.current) {
          clearTimeout(crossfadeTimeoutRef.current);
          crossfadeTimeoutRef.current = null;
        }
        setNextPayload(null);
        setPlayKey((k) => k + 1);
        setPayload(p);
        setLowerThirdVis(false);
        const fadeTo = (p.fadeTo as 'black' | 'transparent') ?? 'black';
        const dur = (p.fadeIn ?? 0) as number;
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
      if (d.type === 'stop') {
        clearTimers();
        setPayload(null);
        setNextPayload(null);
        setFadeOpacity(0);
        setContentOpacity(1);
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
    const unsubCh = subscribeToPlayout(handle);
    const unsubWin = subscribeToWindowMessage(handle);
    return () => {
      unsubCh();
      unsubWin();
      clearTimers();
    };
  }, [clearTimers]);

  // EOC timers when payload is set (skip during crossfade)
  useEffect(() => {
    if (!payload || nextPayload) return;
    const effectiveHold = payload.holdDuration ?? 10;
    if (payload.eoc === 'fade' && payload.fadeOut > 0) {
      const delay = Math.max(0, effectiveHold * 1000 - payload.fadeOut * 1000);
      const fadeOutDur = payload.fadeOut ?? 1;
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

  // Ken Burns animation for main layer
  useLayoutEffect(() => {
    const el = kbRef.current;
    if (!el || !payload) return;
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
      const animName = getKBAnimationName(p.kbAnim);
      el.style.setProperty('--ks', String(scale));
      el.style.animation = `${animName} ${dur}s linear forwards`;
    }
  }, [payload]);

  // Progress bar
  useEffect(() => {
    if (!payload || !progRef.current || nextPayload) return;
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
  }, [payload, nextPayload]);

  const showIdle = !payload;
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

  const imgSrcNext = nextPayload ? getImageSrc(nextPayload) : '';
  const moNext = nextPayload?.modeOpts ?? {};
  const csNext = nextPayload?.captionStyle ?? {};
  const objFitNext = (moNext.objectFit as string) ?? 'cover';
  const vignetteNext = (moNext as { vignette?: boolean }).vignette ?? false;
  const blurAmountNext = (moNext as { blurAmount?: number }).blurAmount ?? 28;
  const bgBrightnessNext = (moNext as { bgBrightness?: number }).bgBrightness ?? 0.45;
  const photoSideNext = (moNext as { splitImageSide?: string }).splitImageSide ?? 'left';
  const textAlignNext = (moNext as { splitTextAlign?: string }).splitTextAlign ?? 'left';
  const isCenterNext = photoSideNext === 'center';
  const centerWNext = (moNext as { splitCenterWidth?: number }).splitCenterWidth ?? 40;
  const centerHNext = (moNext as { splitCenterHeight?: number }).splitCenterHeight ?? 45;
  const splitImgWidthNext = (moNext as { splitImgWidth?: number }).splitImgWidth ?? 55;

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
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
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

      {/* Program layer: cut only */}
      {payload && imgSrc && (
        <div
          key={playKey}
          className="play-layer"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none',
            opacity: contentOpacity,
            transition: contentTransition,
          }}
        >
          {payload.mode === 'fullscreen' && (
            <>
              <div className="kb-layer" ref={kbRef}>
                <img className="fill" src={imgSrc} alt="" style={{ objectFit: objFit as 'cover' | 'contain' }} />
              </div>
              {vignette && <div className="vignette" />}
            </>
          )}
          {payload.mode === 'blurbg' && (
            <div className="kb-layer" ref={kbRef}>
              <div className="blur-bg" style={{ backgroundImage: `url(${imgSrc})`, filter: `blur(${blurAmount}px) brightness(${bgBrightness}) saturate(1.4)` }} />
              <div className="blur-fg"><img src={imgSrc} alt="" /></div>
            </div>
          )}
          {payload.mode === 'split' && (
            <div className="kb-layer" ref={kbRef}>
              <div className="split-bg-layer" style={{ backgroundImage: `url(${imgSrc})` }} />
              {payload.captionOn ? (
                <div className={`split-content ${photoSide === 'right' ? 'split-content--photo-right' : ''} ${isCenter ? 'split-content--photo-center' : ''}`} style={isCenter ? { ['--split-center-img-h' as string]: `${centerH}%` } : undefined}>
                  <div className={isCenter ? 'split-img-wrap split-img-wrap--center' : 'split-img-wrap'} style={isCenter ? { width: `${centerW}%`, height: `${centerH}%` } : { width: `${splitImgWidth}%` }}>
                    <img src={imgSrc} alt="" style={{ objectFit: objFit as 'cover' | 'contain' }} />
                  </div>
                  <div className={`split-text split-text--h-${textAlign}`}>
                    <div className="split-text-inner">
                      {payload.captionTag && <div className="split-tag" style={{ color: cs.accentColor ?? '#d4ff47' }}>{payload.captionTag}</div>}
                      <h2 style={{ color: cs.textColor ?? '#fff' }}>{payload.captionTitle || payload.name}</h2>
                      <p style={{ color: cs.textColor ?? '#fff' }}>{payload.captionSub || payload.subject || ''}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="split-content split-content--full">
                  <div className="split-img-wrap split-img-wrap--full">
                    <img src={imgSrc} alt="" style={{ objectFit: objFit as 'cover' | 'contain' }} />
                  </div>
                </div>
              )}
            </div>
          )}
          {payload.captionOn && payload.mode !== 'split' && (
            <div className={`lower-third pos-${(cs.position as string) || 'bottom'} lt-justify-${(cs.justify as string) ?? 'left'} ${lowerThirdVis ? 'vis' : ''}`} style={{ background: `linear-gradient(transparent, ${hexToRgba((cs.bgColor as string) ?? '#000000', ((cs.bgOpacity as number) ?? 75) / 100)})` }}>
              <div className="lower-third-inner">
                <div className="lt-tag" style={{ color: cs.accentColor ?? '#d4ff47' }}>{payload.captionTag || ''}</div>
                <div className="lt-title" style={{ color: cs.textColor ?? '#fff' }}>{payload.captionTitle || payload.name}</div>
                {payload.captionSub && <div className="lt-sub" style={{ color: cs.textColor ?? '#fff' }}>{payload.captionSub}</div>}
              </div>
            </div>
          )}
          <div className="prog-bar">
            <div ref={progRef} className="prog-fill" style={{ width: '0%' }} />
          </div>
        </div>
      )}

    </div>
  );
}
