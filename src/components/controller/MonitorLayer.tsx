import { useRef, useEffect, useLayoutEffect } from 'react';
import type { Cue, ModeOpts, CaptionStyle } from '../../lib/types';
import {
  getCaptionTitle,
  getCaptionSub,
  getCaptionTag,
  getKBAnim,
  getKBScaleVar,
  getKBScaleVarForPreset,
  getKBDuration,
  getKBAnimationName,
  getCueModeOpts,
  getCueCaptionStyle,
  getCueHoldDuration,
  hexToRgba,
  applyCustomKBKeyframes,
  applyCustomKBKeyframesFromXYZ,
  getCustomKBTransformFromXYZ,
  getCueStartXYZ,
  getCueEndXYZ,
} from '../../lib/controllerHelpers';
import { useMediaUrl } from '../../hooks/useMediaUrl';
import { isStoragePath } from '../../lib/storage';

export interface MonitorLayerProps {
  cue: Cue;
  mode: 'fullscreen' | 'blurbg' | 'split';
  modeOpts: ModeOpts;
  captionStyle: CaptionStyle;
  holdDuration: number;
  zoomScale: number;
  motionSpeed: number;
  kbDirection: string;
  /** For resolving cloud storage paths to signed URLs; null = local only */
  userId?: string | null;
  /** When this changes, KB animation restarts (e.g. for Preview PLAY) */
  playKey?: number;
  /** If true, progress bar fills over holdDuration */
  showProgress?: boolean;
  /** When playing a group: number of images; show dots where each image ends */
  groupSize?: number;
  /** When playing a group: 0–100, total group progress for the bar fill */
  groupProgressPct?: number;
  /** When set, show this keyframe only (no animation) so PVW matches the small editor */
  staticKeyframe?: 'start' | 'end' | null;
  /**
   * Incoming layer: negative animation-delay (seconds) so KB starts at the same
   * proportional progress as the outgoing layer. 0 = start from beginning.
   */
  kbStartOffset?: number;
  /**
   * After crossfade commit: start the main layer's KB from this many seconds in
   * (matching where the incoming layer's animation ended) to avoid a jump.
   * 0 = start from beginning.
   */
  kbContinueFrom?: number;
}

export function MonitorLayer({
  cue,
  mode,
  modeOpts,
  captionStyle,
  holdDuration,
  zoomScale,
  motionSpeed,
  kbDirection,
  userId = null,
  playKey = 0,
  showProgress = false,
  groupSize,
  groupProgressPct = 0,
  staticKeyframe = null,
  kbStartOffset = 0,
  kbContinueFrom = 0,
}: MonitorLayerProps) {
  const kbRef = useRef<HTMLDivElement>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const { url: resolvedUrl, loading: urlLoading } = useMediaUrl(cue.src, userId ?? null);
  const displaySrc = resolvedUrl ?? (isStoragePath(cue.src) ? '' : cue.src);
  const isGroup = (groupSize ?? 0) > 1;
  const mo = getCueModeOpts(cue, modeOpts);
  const cs = getCueCaptionStyle(cue, captionStyle);
  const showCaption = cs.position !== 'off';
  const title = getCaptionTitle(cue);
  const sub = getCaptionSub(cue);
  const tag = getCaptionTag(cue);
  const kbAnim = getKBAnim(cue, kbDirection);
  const kbScaleRaw = getKBScaleVar(cue, zoomScale);
  const kbScale = kbAnim === 'custom' ? kbScaleRaw : getKBScaleVarForPreset(cue, zoomScale);
  const kbDur = getKBDuration(cue, holdDuration, motionSpeed);

  // Apply Ken Burns animation (or static keyframe when editing START/END).
  // useLayoutEffect so continue-from is applied before paint (avoids glitch as transition ends).
  useLayoutEffect(() => {
    const el = kbRef.current;
    if (!el) return;
    const startXYZ = getCueStartXYZ(cue);
    const endXYZ = getCueEndXYZ(cue);
    const isCustomXYZ = (cue.kbAnim === 'custom' || kbDirection === 'custom') && startXYZ && endXYZ;
    const isCustomRect = (cue.kbAnim === 'custom' || kbDirection === 'custom') && cue.kbCustomStart && cue.kbCustomEnd;

    // The effective animation offset: incoming layer uses kbStartOffset,
    // committed main layer uses kbContinueFrom (only one will be non-zero at a time).
    const offset = kbContinueFrom > 0 ? kbContinueFrom : kbStartOffset > 0 ? kbStartOffset : 0;

    // Only clear when starting from 0 so we don't flash a frame when applying continue-from
    if (offset === 0) {
      el.style.animation = 'none';
      el.style.removeProperty('transform');
      void el.offsetWidth;
    }

    if (staticKeyframe && isCustomXYZ && startXYZ && endXYZ) {
      const xyz = staticKeyframe === 'start' ? startXYZ : endXYZ;
      el.style.animation = '';
      el.style.transformOrigin = '50% 50%';
      el.style.setProperty('--ks', '1');
      el.style.transform = getCustomKBTransformFromXYZ(xyz.cx, xyz.cy, xyz.z, kbScale);
    } else if (isCustomXYZ && startXYZ && endXYZ) {
      el.style.setProperty('--ks', '1');
      applyCustomKBKeyframesFromXYZ(el, startXYZ, endXYZ, kbDur, kbScale);
      // Apply delay AFTER helper sets animation shorthand (shorthand resets delay)
      el.style.animationDelay = offset > 0 ? `-${offset}s` : '0s';
    } else if (isCustomRect && cue.kbCustomStart && cue.kbCustomEnd) {
      el.style.setProperty('--ks', '1');
      applyCustomKBKeyframes(el, cue.kbCustomStart, cue.kbCustomEnd, kbDur, kbScale);
      // Apply delay AFTER helper sets animation shorthand
      el.style.animationDelay = offset > 0 ? `-${offset}s` : '0s';
    } else {
      el.style.setProperty('--ks', String(kbScale));
      const animName = getKBAnimationName(kbAnim);
      el.style.animation = `${animName} ${kbDur}s linear forwards`;
      // Apply delay AFTER animation shorthand (which resets delay to 0)
      el.style.animationDelay = offset > 0 ? `-${offset}s` : '0s';
    }
  }, [cue, kbDirection, kbAnim, kbScale, kbDur, playKey, staticKeyframe, kbStartOffset, kbContinueFrom]);

  // Progress bar fill: when group use groupProgressPct from parent; otherwise run per-cue timer
  useEffect(() => {
    if (isGroup && progRef.current) {
      progRef.current.style.width = `${Math.min(100, groupProgressPct)}%`;
      return;
    }
    if (!showProgress || !progRef.current) return;
    const start = Date.now();
    const dur = getCueHoldDuration(cue, holdDuration) * 1000;
    let raf: number;
    const tick = () => {
      const pct = Math.min(((Date.now() - start) / dur) * 100, 100);
      if (progRef.current) progRef.current.style.width = `${pct}%`;
      if (pct < 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isGroup, showProgress, cue.id, holdDuration, playKey, groupProgressPct]);

  if (!displaySrc && urlLoading) {
    return (
      <div className="play-layer" style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'var(--s2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
        Loading image…
      </div>
    );
  }

  if (!displaySrc) {
    return (
      <div className="play-layer" style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'var(--s2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
        No image
      </div>
    );
  }

  return (
    <div className="play-layer" style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
      {mode === 'fullscreen' && (
        <>
          <div className="kb-layer" ref={kbRef}>
            <img
              className="fill"
              src={displaySrc}
              alt=""
              style={{ objectFit: mo.fullscreen?.objectFit ?? 'cover' }}
            />
          </div>
          {mo.fullscreen?.vignette && <div className="vignette" />}
        </>
      )}
      {mode === 'blurbg' && (
        <div className="kb-layer" ref={kbRef}>
          <div
            className="blur-bg"
            style={{
              backgroundImage: `url(${displaySrc})`,
              filter: `blur(${mo.blurbg?.blurAmount ?? 28}px) brightness(${mo.blurbg?.bgBrightness ?? 0.45}) saturate(1.4)`,
            }}
          />
          <div className="blur-fg">
            <img src={displaySrc} alt="" />
          </div>
        </div>
      )}
      {mode === 'split' && (
        <div className="kb-layer" ref={kbRef}>
          <div className="split-bg-layer" style={{ backgroundImage: `url(${displaySrc})` }} />
          {showCaption ? (
            (() => {
              const photoSide = modeOpts.split?.splitImageSide ?? mo.split?.splitImageSide ?? 'left';
              const isCenter = photoSide === 'center';
              const centerH = modeOpts.split?.splitCenterHeight ?? mo.split?.splitCenterHeight ?? 45;
              const hasTag = !!tag;
              const hasSub = !!(sub || (cue.analysis?.subject ?? ''));
              const lineCount = 1 + (hasTag ? 1 : 0) + (hasSub ? 1 : 0);
              return (
                <div
                  className={`split-content ${photoSide === 'right' ? 'split-content--photo-right' : ''} ${isCenter ? 'split-content--photo-center' : ''}`}
                  style={isCenter ? { ['--split-center-img-h' as string]: `${centerH}%` } : undefined}
                >
                  <div
                    className={isCenter ? 'split-img-wrap split-img-wrap--center' : 'split-img-wrap'}
                    style={isCenter
                      ? { width: `${modeOpts.split?.splitCenterWidth ?? mo.split?.splitCenterWidth ?? 40}%`, height: `${centerH}%` }
                      : { width: `${mo.split?.splitImgWidth ?? 55}%` }}
                  >
                    <img
                      src={displaySrc}
                      alt=""
                      style={{ objectFit: mo.fullscreen?.objectFit ?? 'cover' }}
                    />
                  </div>
                  <div
                    className={`split-text split-text--h-${(modeOpts.split?.splitTextAlign ?? mo.split?.splitTextAlign ?? 'left')}${isCenter ? ` split-text--center-lines-${lineCount}` : ''}`}
                  >
                    <div className="split-text-inner">
                      {tag && <div className="split-tag" style={{ color: cs.accentColor }}>{tag}</div>}
                      <h2 style={{ color: cs.textColor }}>{title || cue.name}</h2>
                      <p style={{ color: cs.textColor }}>{sub || (cue.analysis?.subject ?? '')}</p>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="split-content split-content--full">
              <div className="split-img-wrap split-img-wrap--full">
                <img
                  src={displaySrc}
                  alt=""
                  style={{ objectFit: mo.fullscreen?.objectFit ?? 'cover' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {showCaption && mode !== 'split' && (
        <div
          className={`lower-third pos-${cs.position} lt-justify-${cs.justify ?? 'left'} vis`}
          style={{
            background: `linear-gradient(transparent, ${hexToRgba(cs.bgColor, cs.bgOpacity / 100)})`,
          }}
        >
          <div className="lower-third-inner">
            <div className="lt-tag" style={{ color: cs.accentColor }}>{tag}</div>
            <div className="lt-title" style={{ color: cs.textColor }}>{title || cue.name}</div>
            {sub && <div className="lt-sub" style={{ color: cs.textColor }}>{sub}</div>}
          </div>
        </div>
      )}

      <div className={`prog-bar ${isGroup ? 'prog-bar-group' : ''}`}>
        <div ref={progRef} className="prog-fill" style={{ width: isGroup ? `${groupProgressPct}%` : (showProgress ? '0%' : '0%') }} />
        {isGroup && groupSize != null && Array.from({ length: groupSize }, (_, i) => (
          <div
            key={i}
            className="prog-bar-dot"
            style={{ left: `${((i + 1) / groupSize) * 100}%` }}
            title={`Image ${i + 1} ends`}
          />
        ))}
      </div>
    </div>
  );
}
