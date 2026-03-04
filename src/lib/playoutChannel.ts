import type { PlayoutPayload } from './types';
import { isCloudStoredCue, getSignedUrl } from './storage';

export const PLAYOUT_CHANNEL_NAME = 'frameflow_playout_v1';

export type PlayoutMessage =
  | { type: 'play'; [key: string]: unknown }
  | { type: 'stop' }
  | { type: 'fadeOut'; duration?: number; partial?: boolean; fadeTo?: 'black' | 'transparent' }
  | { type: 'fadeIn'; duration?: number }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'init'; aspect?: string }
  | { type: 'connect'; code: string }
  | { type: 'connectionAccepted' }
  | { type: 'heartbeat' };

/** Playout sends heartbeat this often (low egress). */
export const HEARTBEAT_INTERVAL_MS = 45_000;
/** Controller marks output disconnected after no heartbeat for this long. */
export const DISCONNECT_AFTER_MS = 60_000;
/** Controller checks last-seen this often. */
export const CONNECTED_CHECK_INTERVAL_MS = 15_000;

let channel: BroadcastChannel | null = null;

export function getPlayoutChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(PLAYOUT_CHANNEL_NAME);
  }
  return channel;
}

export function sendToPlayout(message: PlayoutMessage, playoutWindow: Window | null = null): void {
  const ch = getPlayoutChannel();
  ch.postMessage(message);
  if (playoutWindow && !playoutWindow.closed) {
    playoutWindow.postMessage(message, '*');
  }
}

/** Send a play payload to playout; resolves cloud storage src to a signed URL when userId is set. */
export async function sendPlayPayload(
  payload: PlayoutPayload,
  playoutWindow: Window | null,
  userId: string | null
): Promise<void> {
  if (userId && isCloudStoredCue(payload.src)) {
    try {
      const url = await getSignedUrl(userId, payload.src);
      sendToPlayout({ ...payload, resolvedSrc: url }, playoutWindow);
    } catch {
      sendToPlayout(payload, playoutWindow);
    }
  } else {
    sendToPlayout(payload, playoutWindow);
  }
}

export function subscribeToPlayout(callback: (message: PlayoutMessage) => void): () => void {
  const ch = getPlayoutChannel();
  const handler = (e: MessageEvent) => callback(e.data as PlayoutMessage);
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}

export function subscribeToWindowMessage(callback: (message: PlayoutMessage) => void): () => void {
  const handler = (e: MessageEvent) => {
    if (e.data && typeof e.data === 'object' && 'type' in e.data) {
      callback(e.data as PlayoutMessage);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
