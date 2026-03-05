import type { PlayoutPayload } from './types';
import { isCloudStoredCue, getSignedUrl } from './storage';
import { isLocalCueSrc, uploadTempAsset } from './tempAsset';
import { supabase } from './supabase';

export const PLAYOUT_CHANNEL_NAME = 'frameflow_playout_v1';

const REALTIME_EVENT = 'playout';

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

/** Realtime channel used by controller to receive connect/heartbeat and send commands. */
let realtimeChannelRef: { send: (payload: object) => void } | null = null;

function getRealtimeChannelName(code: string): string {
  return `playout:${String(code).trim().toUpperCase()}`;
}

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
  if (realtimeChannelRef) {
    realtimeChannelRef.send({ type: 'broadcast', event: REALTIME_EVENT, payload: message });
  }
}

/** Send a play payload to playout; resolves cloud src to signed URL, local src to temp-asset URL (same network). */
export async function sendPlayPayload(
  payload: PlayoutPayload,
  playoutWindow: Window | null,
  userId: string | null
): Promise<void> {
  if (userId && isCloudStoredCue(payload.src)) {
    try {
      const url = await getSignedUrl(userId, payload.src);
      sendToPlayout({ ...payload, resolvedSrc: url }, playoutWindow);
      return;
    } catch {
      sendToPlayout(payload, playoutWindow);
      return;
    }
  }
  if (isLocalCueSrc(payload.src)) {
    try {
      const url = await uploadTempAsset(payload.src);
      // Send small URL only — do not send the huge data URL in the payload or Realtime may drop the message
      sendToPlayout({ ...payload, src: url, resolvedSrc: url }, playoutWindow);
      return;
    } catch (err) {
      console.warn('[Playout] Local image upload failed (is the API server running? npm run server):', err instanceof Error ? err.message : err);
      sendToPlayout(payload, playoutWindow);
      return;
    }
  }
  sendToPlayout(payload, playoutWindow);
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

// --- Supabase Realtime (cross-browser / cross-device) ---

/** Controller: join channel for this connection code; receive connect/heartbeat from playout(s). Returns unsubscribe. */
export function joinPlayoutChannelAsController(
  code: string,
  onMessage: (message: PlayoutMessage) => void
): () => void {
  if (!supabase) return () => {};
  const name = getRealtimeChannelName(code);
  const channel = supabase.channel(name);
  channel.on('broadcast', { event: REALTIME_EVENT }, (p: { payload: PlayoutMessage }) => {
    onMessage(p.payload);
  });
  channel.subscribe();
  realtimeChannelRef = channel;
  return () => {
    realtimeChannelRef = null;
    void supabase.removeChannel(channel);
  };
}

/** Playout: join channel, send connect, receive all controller messages. Returns { send, unsubscribe }. */
export function connectToPlayoutChannelAsPlayout(
  code: string,
  onMessage: (message: PlayoutMessage) => void
): Promise<{ send: (message: PlayoutMessage) => void; unsubscribe: () => void }> {
  if (!supabase) return Promise.reject(new Error('Supabase not configured'));
  const name = getRealtimeChannelName(code);
  const channel = supabase.channel(name);
  channel.on('broadcast', { event: REALTIME_EVENT }, (p: { payload: PlayoutMessage }) => {
    onMessage(p.payload);
  });
  return new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: REALTIME_EVENT,
          payload: { type: 'connect', code: code.trim().toUpperCase() },
        });
        resolve({
          send: (msg: PlayoutMessage) =>
            channel.send({ type: 'broadcast', event: REALTIME_EVENT, payload: msg }),
          unsubscribe: () => {
            void supabase.removeChannel(channel);
          },
        });
      }
      if (status === 'CHANNEL_ERROR') {
        reject(new Error('Failed to join playout channel'));
      }
    });
  });
}
