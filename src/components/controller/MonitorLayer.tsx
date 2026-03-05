import { useRef, useEffect, useLayoutEffect, useState } from 'react';
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
  getBlurContainMaxScale,
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
  /** When set (single item), use this for bar fill so it stays in sync with controller clock */
  itemProgressPct?: number;
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
  itemProgressPct,
  staticKeyframe = null,
  kbStartOffset = 0,
  kbContinueFrom = 0,
}: MonitorLayerProps) {
  const kbRef = useRef<HTMLDivElement>(null);
  const splitKbRef = useRef<HTMLDivElement>(null);
  const blurKbRef = useRef<HTMLDivElement>(null);
  const blurImgRef = useRef<HTMLImageElement>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const [blurImageSize, setBlurImageSize] = useState<{ w: number; h: number } | null>(null);
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
  // In split/blurbg the "frame" is fixed; only the image inside it moves.
  useLayoutEffect(() => {
    const el = mode === 'split' ? splitKbRef.current : mode === 'blurbg' ? blurKbRef.current : kbRef.current;
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
      let effectiveKs = kbScale;
      const fillFrame = mo.blurbg?.fillFrame !== false;
      if (mode === 'blurbg' && !fillFrame && blurImageSize && mo.blurbg) {
        const fw = mo.blurbg.frameWidth ?? 70;
        const fh = mo.blurbg.frameHeight ?? 70;
        const frameAspect = (fw / fh) * (16 / 9);
        const imageAspect = blurImageSize.w / blurImageSize.h;
        const maxZoom = getBlurContainMaxScale(frameAspect, imageAspect);
        effectiveKs = Math.min(kbScale, maxZoom);
      }
      el.style.setProperty('--ks', String(effectiveKs));
      const animName = getKBAnimationName(kbAnim);
      el.style.animation = `${animName} ${kbDur}s ease-in-out forwards`;
      // Apply delay AFTER animation shorthand (which resets delay to 0)
      el.style.animationDelay = offset > 0 ? `-${offset}s` : '0s';
    }
  }, [mode, cue, kbDirection, kbAnim, kbScale, kbDur, playKey, staticKeyframe, kbStartOffset, kbContinueFrom, blurImageSize, mo.blurbg]);

  useEffect(() => {
    setBlurImageSize(null);
  }, [displaySrc]);

  // When in blurbg, capture image dimensions from cached img if onLoad didn't run
  useLayoutEffect(() => {
    if (mode !== 'blurbg' || !displaySrc) return;
    const img = blurImgRef.current;
    if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0 && !blurImageSize) {
      setBlurImageSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [mode, displaySrc, blurImageSize]);

  // Progress bar fill: when group use groupProgressPct from parent; when single and itemProgressPct provided use it (sync with controller); else run local timer
  useEffect(() => {
    if (!progRef.current) return;
    if (isGroup) {
      progRef.current.style.width = `${Math.min(100, groupProgressPct)}%`;
      return;
    }
    if (itemProgressPct != null && showProgress) {
      progRef.current.style.width = `${Math.min(100, itemProgressPct)}%`;
      return;
    }
    if (!showProgress) return;
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
  }, [isGroup, showProgress, cue.id, holdDuration, playKey, groupProgressPct, itemProgressPct]);

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
      {mode === 'blurbg' && (() => {
        const fw = mo.blurbg?.frameWidth ?? 70;
        const fh = mo.blurbg?.frameHeight ?? 70;
        const fillFrame = mo.blurbg?.fillFrame !== false;
        const showBorder = mo.blurbg?.showBorder ?? false;
        const borderColor = mo.blurbg?.borderColor ?? '#ffffff';
        const borderWidth = mo.blurbg?.borderWidth ?? 2;
        const frameAspect = (fw / fh) * (16 / 9);
        const imageAspect = blurImageSize ? blurImageSize.w / blurImageSize.h : 16 / 9;
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
            <div
              className="blur-bg"
              style={{
                backgroundImage: `url(${displaySrc})`,
                filter: `blur(${mo.blurbg?.blurAmount ?? 28}px) brightness(${mo.blurbg?.bgBrightness ?? 0.45}) saturate(1.4)`,
              }}
            />
            <div className="blur-frame" style={frameStyle}>
              <div className="blur-fill-wrap" style={fillWrapStyle}>
                <div className="blur-kb-inner" ref={blurKbRef}>
                  <img
                    ref={blurImgRef}
                    src={displaySrc}
                    alt=""
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) setBlurImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {mode === 'split' && (
        <>
          {/* Photo placement (Left/Right/Center + size) is the fixed frame; only the image inside it gets Ken Burns */}
          <div className="kb-layer">
            <div className="split-bg-layer" style={{ backgroundImage: `url(${displaySrc})` }} />
            {showCaption ? (
              (() => {
                const photoSide = modeOpts.split?.splitImageSide ?? mo.split?.splitImageSide ?? 'left';
                const isCenter = photoSide === 'center';
                const centerH = modeOpts.split?.splitCenterHeight ?? mo.split?.splitCenterHeight ?? 45;
                const imgWidth = mo.split?.splitImgWidth ?? 55;
                const showBorder = modeOpts.split?.showBorder ?? mo.split?.showBorder ?? false;
                const borderStyle = showBorder ? { border: `${modeOpts.split?.borderWidth ?? mo.split?.borderWidth ?? 2}px solid ${modeOpts.split?.borderColor ?? mo.split?.borderColor ?? '#ffffff'}` } : {};
                return (
                  <div
                    className={`split-content split-content--img-only ${photoSide === 'right' ? 'split-content--photo-right' : ''} ${isCenter ? 'split-content--photo-center' : ''}`}
                    style={
                      isCenter
                        ? { ['--split-center-img-h' as string]: `${centerH}%` }
                        : { ['--split-img-width' as string]: `${imgWidth}%` }
                    }
                  >
                    <div
                      className={isCenter ? 'split-img-wrap split-img-wrap--center' : 'split-img-wrap'}
                      style={{
                        ...(isCenter
                          ? { width: `${modeOpts.split?.splitCenterWidth ?? mo.split?.splitCenterWidth ?? 40}%`, height: `${centerH}%` }
                          : { width: `${imgWidth}%` }),
                        ...borderStyle,
                      }}
                    >
                      <div className="split-kb-inner" ref={splitKbRef}>
                        <img
                          src={displaySrc}
                          alt=""
                          style={{ objectFit: mo.fullscreen?.objectFit ?? 'cover' }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="split-content split-content--full">
                <div
                  className="split-img-wrap split-img-wrap--full"
                  style={(modeOpts.split?.showBorder ?? mo.split?.showBorder) ? { border: `${modeOpts.split?.borderWidth ?? mo.split?.borderWidth ?? 2}px solid ${modeOpts.split?.borderColor ?? mo.split?.borderColor ?? '#ffffff'}` } : {}}
                >
                  <div className="split-kb-inner" ref={splitKbRef}>
                    <img
                      src={displaySrc}
                      alt=""
                      style={{ objectFit: mo.fullscreen?.objectFit ?? 'cover' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Caption text outside kb-layer so it does not move with Ken Burns */}
          {showCaption && (() => {
            const photoSide = modeOpts.split?.splitImageSide ?? mo.split?.splitImageSide ?? 'left';
            const isCenter = photoSide === 'center';
            const centerH = modeOpts.split?.splitCenterHeight ?? mo.split?.splitCenterHeight ?? 45;
            const hasTag = !!tag;
            const hasSub = !!(sub || (cue.analysis?.subject ?? ''));
            const lineCount = 1 + (hasTag ? 1 : 0) + (hasSub ? 1 : 0);
            const imgWidth = mo.split?.splitImgWidth ?? 55;
            const textScale = Math.max(0.5, Math.min(2, cs.textScale ?? 1));
            const offsetY = (cs as { offsetY?: number }).offsetY ?? 0;
            const textAlign = modeOpts.split?.splitTextAlign ?? mo.split?.splitTextAlign ?? 'left';
            const splitOrigin = textAlign === 'center' ? 'top center' : textAlign === 'right' ? 'top right' : 'top left';
            const overlayStyle: React.CSSProperties = isCenter
              ? { top: `${centerH}%`, left: 0, right: 0, bottom: 0 }
              : photoSide === 'right'
                ? { left: 0, right: `${100 - imgWidth}%`, top: 0, bottom: 0 }
                : { left: `${imgWidth}%`, right: 0, top: 0, bottom: 0 };
            return (
              <div
                className={`split-text split-text--fixed split-text--h-${textAlign}${isCenter ? ` split-text--center-lines-${lineCount}` : ''}`}
                style={{
                  ...overlayStyle,
                  position: 'absolute',
                  margin: 0,
                  transformOrigin: splitOrigin,
                  transform: `scale(${textScale}) translateY(${-offsetY}px)`,
                }}
              >
                <div className="split-text-inner">
                  {tag && <div className="split-tag" style={{ color: cs.accentColor }}>{tag}</div>}
                  <h2 style={{ color: cs.textColor }}>{title || cue.name}</h2>
                  <p style={{ color: cs.textColor }}>{sub || (cue.analysis?.subject ?? '')}</p>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {showCaption && mode !== 'split' && (
        <div
          className={`lower-third pos-${cs.position} lt-justify-${cs.justify ?? 'left'} vis`}
          style={{
            background: `linear-gradient(transparent, ${hexToRgba(cs.bgColor, cs.bgOpacity / 100)})`,
          }}
        >
          <div
            className="lower-third-inner"
            style={{
              transformOrigin: cs.justify === 'center' ? 'bottom center' : cs.justify === 'right' ? 'bottom right' : 'bottom left',
              transform: `scale(${Math.max(0.5, Math.min(2, cs.textScale ?? 1))}) translateY(${-((cs as { offsetY?: number }).offsetY ?? 0)}px)`,
            }}
          >
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
