/**
 * Companion integration: same connection code as playout.
 * Channel: companion:CODE
 * - Controller subscribes to "companion_cmd" (take, next, prev, cue, clear, fade).
 * - Controller broadcasts "companion_state" (liveIndex, nextIndex, isLive, cues, etc.).
 */
import { supabase } from './supabase';

export const COMPANION_EVENT_STATE = 'companion_state';
export const COMPANION_EVENT_CMD = 'companion_cmd';
export const COMPANION_EVENT_REQUEST_STATE = 'companion_request_state';

export function getCompanionChannelName(code: string): string {
  return `companion:${String(code).trim().toUpperCase()}`;
}

export interface CompanionCueSummary {
  index: number;
  id: string;
  name: string;
  displayName?: string;
  captionTitle?: string;
  /** End-of-cue: 'hold' | 'fade' | 'clear'. */
  eoc?: string;
  /** Label for the button: display name + " →" when auto-next (eoc !== 'hold'). Use this for button text. */
  buttonLabel?: string;
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

export interface JoinCompanionChannelOptions {
  /** When the API (or another client) requests state, call this so the controller sends current state. */
  onRequestState?: () => void;
  /** When the channel is SUBSCRIBED (WebSocket ready), call this with sendState so the controller can use it. Sending before SUBSCRIBED uses REST and may not reach other clients. */
  onSubscribed?: (sendState: (state: CompanionStatePayload) => void) => void;
}

export function joinCompanionChannelAsController(
  code: string,
  onCommand: (cmd: CompanionCommandPayload) => void,
  options?: JoinCompanionChannelOptions
): { unsubscribe: () => void } {
  if (!supabase) {
    return { unsubscribe: () => {} };
  }
  const name = getCompanionChannelName(code);
  const channel = supabase.channel(name);
  channel.on('broadcast', { event: COMPANION_EVENT_CMD }, (p: { payload: CompanionCommandPayload }) => {
    onCommand(p.payload);
  });
  channel.on('broadcast', { event: COMPANION_EVENT_REQUEST_STATE }, () => {
    options?.onRequestState?.();
  });

  function sendState(state: CompanionStatePayload) {
    channel.send({
      type: 'broadcast',
      event: COMPANION_EVENT_STATE,
      payload: state,
    });
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      options?.onSubscribed?.(sendState);
    }
  });

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
