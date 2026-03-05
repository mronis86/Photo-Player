/**
 * Program output view — same two-layer (outgoing + main) rendering as the controller's
 * program monitor. Used for the in-app PGM preview and for the "Test output" window
 * so the test output is literally the same React tree (no fade jump).
 */
import type { Cue, ModeOpts, CaptionStyle, WipeDirection } from '../../lib/types';
import { getCueModeOpts, getCueCaptionStyle, getWipeClipPath } from '../../lib/controllerHelpers';
import { MonitorLayer } from './MonitorLayer';

export interface ProgramOutputViewProps {
  isLive: boolean;
  programCue: Cue | null | undefined;
  programOutgoingCue: Cue | null;
  programCrossfadeNextCue: Cue | null;
  programTransitionKind: 'fade' | 'wipe' | null;
  programWipeRevealPct: number;
  programCueItemIdx: number;
  effectiveProgramItemIdx: number;
  effectiveProgramCue: Cue | null | undefined;
  programCrossfadeOutOpacity: number;
  programCrossfadeInOpacity: number;
  programCrossfadeDuration: number;
  effectiveProgramMode: 'fullscreen' | 'blurbg' | 'split';
  effectiveProgramModeOpts: ModeOpts;
  effectiveProgramCaptionStyle: CaptionStyle;
  holdDuration: number;
  zoomScale: number;
  motionSpeed: number;
  kbDirection: string;
  progressPct: number;
  selectedMode: 'fullscreen' | 'blurbg' | 'split';
  modeOpts: ModeOpts;
  captionStyle: CaptionStyle;
  wipeDirection: WipeDirection;
  userId: string | null | undefined;
  /** When true, show minimal UI (no PGM label/badge). For test output window. */
  minimal?: boolean;
}

export function ProgramOutputView({
  isLive,
  programCue,
  programOutgoingCue,
  programCrossfadeNextCue,
  programTransitionKind,
  programWipeRevealPct,
  programCueItemIdx,
  effectiveProgramItemIdx,
  effectiveProgramCue,
  programCrossfadeOutOpacity,
  programCrossfadeInOpacity,
  programCrossfadeDuration,
  effectiveProgramMode,
  effectiveProgramModeOpts,
  effectiveProgramCaptionStyle,
  holdDuration,
  zoomScale,
  motionSpeed,
  kbDirection,
  progressPct,
  selectedMode,
  modeOpts,
  captionStyle,
  wipeDirection,
  userId,
  minimal = false,
}: ProgramOutputViewProps) {
  const hasContent = isLive && (programCue || programOutgoingCue || programCrossfadeNextCue);

  return (
    <div
      className="preview-wrap pgm-wrap"
      data-asp="16:9"
      style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}
    >
      <div
        className="preview-placeholder"
        style={{ display: hasContent ? 'none' : 'flex' }}
      >
        <div className="ph-icon">◫</div>
        <div className="ph-txt">AWAITING CUE</div>
      </div>
      {/* Outgoing layer only during fade/wipe; same key as pre-transition so no remount/jump */}
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
            transition:
              programTransitionKind === 'wipe'
                ? 'none'
                : `opacity ${programCrossfadeDuration}s ease`,
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
            userId={userId ?? null}
            showProgress={false}
          />
        </div>
      )}
      {/* Main layer (incoming during fade/wipe, then solo); same key so no remount when transition ends */}
      {isLive && (programCue || programOutgoingCue || programCrossfadeNextCue) && effectiveProgramCue && (
        <div
          key={`pgm-${effectiveProgramItemIdx}`}
          className="play-layer"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 11,
            pointerEvents: 'none',
            opacity:
              programTransitionKind === 'wipe'
                ? 1
                : programCrossfadeNextCue
                  ? programCrossfadeInOpacity
                  : 1,
            transition:
              programTransitionKind === 'wipe'
                ? 'none'
                : programCrossfadeNextCue
                  ? `opacity ${programCrossfadeDuration}s ease`
                  : 'none',
            ...(programTransitionKind === 'wipe'
              ? {
                  clipPath: getWipeClipPath(
                    (effectiveProgramCue.wipeDirection as WipeDirection) ?? wipeDirection,
                    programWipeRevealPct
                  ),
                }
              : {}),
          }}
        >
          <MonitorLayer
            cue={effectiveProgramCue}
            mode={effectiveProgramCue?.mode ?? selectedMode}
            modeOpts={
              effectiveProgramCue
                ? getCueModeOpts(effectiveProgramCue, modeOpts)
                : modeOpts
            }
            captionStyle={
              effectiveProgramCue
                ? getCueCaptionStyle(effectiveProgramCue, captionStyle)
                : captionStyle
            }
            holdDuration={holdDuration}
            zoomScale={zoomScale}
            motionSpeed={motionSpeed}
            kbDirection={effectiveProgramCue?.kbAnim ?? kbDirection}
            userId={userId ?? null}
            showProgress={!programCrossfadeNextCue}
            itemProgressPct={progressPct}
          />
        </div>
      )}
      {!minimal && (
        <>
          <div className="monitor-overlay-label pgm-label">PGM</div>
          <div className={`playout-badge ${isLive ? 'vis' : ''}`}>● PLAYOUT</div>
        </>
      )}
    </div>
  );
}
