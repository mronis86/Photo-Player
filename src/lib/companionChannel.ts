/**
 * Companion integration: same connection code as playout.
 * Channel: companion:CODE
 * - Controller subscribes to "companion_cmd" (take, next, prev, cue, clear, fade).
 * - Controller broadcasts "companion_state" (liveIndex, nextIndex, isLive, cues, etc.).
 */
import { supabase } from './supabase';

export const COMPANION_EVENT_STATE = 'companion_state';
export const COMPANION_EVENT_CMD = 'companion_cmd';

export function getCompanionChannelName(code: string): string {
  return `companion:${String(code).trim().toUpperCase()}`;
}

export interface CompanionCueSummary {
  index: number;
  id: string;
  name: string;
  displayName?: string;
  captionTitle?: string;
}

export interface CompanionStatePayload {
  liveIndex: number;
  nextIndex: number;
  isLive: boolean;
  playoutConnected: boolean;
  cues: CompanionCueSummary[];
}

export type CompanionCommandType = 'take' | 'next' | 'prev' | 'cue' | 'clear' | 'fade';

export interface CompanionCommandPayload {
  type: CompanionCommandType;
  cueIndex?: number;
  fadeTo?: 'black' | 'transparent';
}

export function joinCompanionChannelAsController(
  code: string,
  onCommand: (cmd: CompanionCommandPayload) => void
): { unsubscribe: () => void; sendState: (state: CompanionStatePayload) => void } {
  if (!supabase) {
    return {
      unsubscribe: () => {},
      sendState: () => {},
    };
  }
  const name = getCompanionChannelName(code);
  const channel = supabase.channel(name);
  channel.on('broadcast', { event: COMPANION_EVENT_CMD }, (p: { payload: CompanionCommandPayload }) => {
    onCommand(p.payload);
  });
  channel.subscribe();

  function sendState(state: CompanionStatePayload) {
    channel.send({
      type: 'broadcast',
      event: COMPANION_EVENT_STATE,
      payload: state,
    });
  }

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
    sendState,
  };
}
