/**
 * Companion API (SaaS): HTTP + WebSocket for Bitfocus Companion.
 * Deploy to Railway; no local install. Same connection code as playout.
 * - HTTP: trigger (take, next, ...) and poll state/cues.
 * - WebSocket: register with code, receive live state, send commands.
 */
import 'dotenv/config';
import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT) || 3333;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

const COMPANION_EVENT_STATE = 'companion_state';
const COMPANION_EVENT_CMD = 'companion_cmd';
const COMPANION_EVENT_REQUEST_STATE = 'companion_request_state';

function getCompanionChannelName(code) {
  return `companion:${String(code).trim().toUpperCase()}`;
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (e.g. in .env or Railway env)');
  process.exit(1);
}

// Log which Supabase project we use – must match the webapp or companion_state table is empty here
try {
  const u = new URL(SUPABASE_URL);
  console.log('[Companion API] Supabase project:', u.origin, '| Table companion_state must exist here and match webapp project');
} catch (_) {}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** code -> { state, channel?, wsClients: Set }. State can come from HTTP POST (primary) or Supabase Realtime. */
const channelsByCode = new Map();

/** WebSocket clients registered per code (for pushing state) */
function getWsClients(code) {
  const key = code.trim().toUpperCase();
  if (!key) return null;
  const entry = channelsByCode.get(key);
  return entry?.wsClients ?? null;
}

/** Get or create entry. State can be set by POST /state without creating a Supabase channel. */
function getOrCreateEntry(code) {
  const key = code.trim().toUpperCase();
  if (!key) return null;
  let entry = channelsByCode.get(key);
  if (entry) return entry;
  entry = { state: null, channel: null, wsClients: new Set() };
  channelsByCode.set(key, entry);
  return entry;
}

/** Ensure Supabase channel exists (for sending commands). Created on first command or when using Realtime state. */
function getOrCreateChannel(code) {
  const key = code.trim().toUpperCase();
  if (!key) return null;
  const entry = getOrCreateEntry(key);
  if (entry.channel) return entry;
  const name = getCompanionChannelName(key);
  const channel = supabase.channel(name);
  entry.channel = channel;
  channel.on('broadcast', { event: COMPANION_EVENT_STATE }, ({ payload }) => {
    entry.state = payload;
    const cueCount = Array.isArray(payload?.cues) ? payload.cues.length : 0;
    console.log(`[Companion API] state received (Realtime) code=${key} cues=${cueCount} liveIndex=${payload?.liveIndex ?? -1}`);
    entry.wsClients.forEach((ws) => {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: 'state', payload }));
        } catch (_) {}
      }
    });
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[Companion API] subscribed code=${key}, requesting state`);
      channel.send({
        type: 'broadcast',
        event: COMPANION_EVENT_REQUEST_STATE,
        payload: {},
      });
    }
  });
  console.log(`[Companion API] new channel code=${key}`);
  return entry;
}

const app = express();
app.use(express.json());
app.set('etag', false);

// CORS: allow webapp (controller) to POST state from browser
const ALLOW_ORIGIN = (process.env.ALLOW_ORIGIN || '*').trim();
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function getCode(req) {
  return (req.query.code || req.body?.code || '').trim().toUpperCase();
}

function requireCode(req, res, next) {
  const code = getCode(req);
  if (!code) {
    res.status(400).json({ error: 'Missing code (query ?code= or body.code). Use same code as playout.' });
    return;
  }
  req.companionCode = code;
  next();
}

// --- State: HTTP primary. Controller POSTs state; module GETs it. No Realtime required for state. ---
app.post('/state', requireCode, (req, res) => {
  const entry = getOrCreateEntry(req.companionCode);
  const body = req.body || {};
  const liveIndex = typeof body.liveIndex === 'number' ? body.liveIndex : -1;
  const nextIndex = typeof body.nextIndex === 'number' ? body.nextIndex : 0;
  entry.state = {
    liveIndex,
    nextIndex,
    isLive: Boolean(body.isLive),
    playoutConnected: Boolean(body.playoutConnected),
    cues: Array.isArray(body.cues) ? body.cues : [],
  };
  const cueCount = entry.state.cues.length;
  console.log(`[Companion API] POST /state code=${req.companionCode} cues=${cueCount} liveIndex=${liveIndex}`);
  res.json({ ok: true });
});

// When we have no cached state, wait briefly for controller to respond (max 2s) – only if using Realtime path
function waitForState(entry, maxMs = 2000) {
  return new Promise((resolve) => {
    if (entry.state) {
      resolve(entry.state);
      return;
    }
    const start = Date.now();
    const check = () => {
      if (entry.state) {
        resolve(entry.state);
        return;
      }
      if (Date.now() - start >= maxMs) resolve(null);
      else setTimeout(check, 100);
    };
    setTimeout(check, 150);
  });
}

// Read state from Supabase table (controller writes there). Railway must use same Supabase project as webapp.
async function fetchStateFromTable(code) {
  const key = String(code).trim().toUpperCase();
  if (!key) return null;
  try {
    const { data, error } = await supabase.from('companion_state').select('state').eq('connection_code', key).maybeSingle();
    if (error) {
      console.warn('[Companion API] companion_state SELECT failed code=', key, 'error=', error.message, 'code=', error.code);
      return null;
    }
    if (data?.state && typeof data.state === 'object') {
      const n = Array.isArray(data.state.cues) ? data.state.cues.length : 0;
      console.log('[Companion API] companion_state read code=', key, 'cues=', n);
      return data.state;
    }
    console.log('[Companion API] companion_state no row for code=', key);
    return null;
  } catch (e) {
    console.warn('[Companion API] companion_state fetch exception', e?.message || e);
    return null;
  }
}

app.get('/state', requireCode, async (req, res) => {
  const code = req.companionCode;
  // Always try table first (source of truth from controller); then in-memory; then wait for Realtime.
  let state = await fetchStateFromTable(code);
  const entry = getOrCreateEntry(code);
  let fromTable = !!state;
  if (state) entry.state = state;
  if (!state) state = entry.state;
  if (!state) state = await waitForState(entry);
  state = state || { liveIndex: -1, nextIndex: 0, isLive: false, playoutConnected: false, cues: [] };
  const cueCount = Array.isArray(state.cues) ? state.cues.length : 0;
  console.log(`[Companion API] GET /state code=${code} cues=${cueCount}${fromTable ? ' (from table)' : ''}`);
  res.json(state);
});

app.get('/cues', requireCode, (req, res) => {
  const entry = getOrCreateEntry(req.companionCode);
  const cues = entry.state?.cues ?? [];
  res.json(cues);
});

// --- Trigger ---
// Commands are broadcast to the controller via Supabase Realtime. On Node/Railway you may see
// "Realtime send() is automatically falling back to REST API" – delivery still works.
function sendCommand(code, payload) {
  const entry = getOrCreateChannel(code);
  const cmdStr = payload.type === 'cue' ? `cue ${payload.cueIndex}` : payload.type === 'fade' ? `fade ${payload.fadeTo}` : payload.type;
  console.log(`[Companion API] command code=${code} ${cmdStr}`);
  entry.channel.send({
    type: 'broadcast',
    event: COMPANION_EVENT_CMD,
    payload,
  });
}

app.get('/take', requireCode, (req, res) => {
  sendCommand(req.companionCode, { type: 'take' });
  res.json({ ok: true, action: 'take' });
});

app.get('/next', requireCode, (req, res) => {
  sendCommand(req.companionCode, { type: 'next' });
  res.json({ ok: true, action: 'next' });
});

app.get('/prev', requireCode, (req, res) => {
  sendCommand(req.companionCode, { type: 'prev' });
  res.json({ ok: true, action: 'prev' });
});

app.get('/cue/:index', requireCode, (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (!Number.isFinite(index) || index < 0) {
    res.status(400).json({ error: 'Invalid cue index' });
    return;
  }
  sendCommand(req.companionCode, { type: 'cue', cueIndex: index });
  res.json({ ok: true, action: 'cue', cueIndex: index });
});

app.get('/clear', requireCode, (req, res) => {
  sendCommand(req.companionCode, { type: 'clear' });
  res.json({ ok: true, action: 'clear' });
});

app.get('/fade', requireCode, (req, res) => {
  const to = (req.query.to || 'black') === 'transparent' ? 'transparent' : 'black';
  sendCommand(req.companionCode, { type: 'fade', fadeTo: to });
  res.json({ ok: true, action: 'fade', fadeTo: to });
});

app.get('/health', (_, res) => {
  res.json({ ok: true, service: 'frameflow-companion-api' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let registeredCode = null;
  ws.on('message', (data) => {
    try {
      const msg = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
      if (msg.type === 'register' && msg.code) {
        const code = String(msg.code).trim().toUpperCase();
        if (registeredCode) {
          const prev = channelsByCode.get(registeredCode);
          if (prev?.wsClients) prev.wsClients.delete(ws);
        }
        registeredCode = code;
        const entry = getOrCreateChannel(code);
        entry.wsClients.add(ws);
        ws.send(JSON.stringify({ type: 'registered', code }));
        if (entry.state) {
          ws.send(JSON.stringify({ type: 'state', payload: entry.state }));
        }
        return;
      }
      if (!registeredCode) {
        ws.send(JSON.stringify({ error: 'Send { type: "register", code: "AB12XY" } first' }));
        return;
      }
      switch (msg.type) {
        case 'take':
          sendCommand(registeredCode, { type: 'take' });
          ws.send(JSON.stringify({ ok: true, action: 'take' }));
          break;
        case 'next':
          sendCommand(registeredCode, { type: 'next' });
          ws.send(JSON.stringify({ ok: true, action: 'next' }));
          break;
        case 'prev':
          sendCommand(registeredCode, { type: 'prev' });
          ws.send(JSON.stringify({ ok: true, action: 'prev' }));
          break;
        case 'cue':
          sendCommand(registeredCode, { type: 'cue', cueIndex: msg.cueIndex });
          ws.send(JSON.stringify({ ok: true, action: 'cue', cueIndex: msg.cueIndex }));
          break;
        case 'clear':
          sendCommand(registeredCode, { type: 'clear' });
          ws.send(JSON.stringify({ ok: true, action: 'clear' }));
          break;
        case 'fade':
          sendCommand(registeredCode, { type: 'fade', fadeTo: msg.fadeTo || 'black' });
          ws.send(JSON.stringify({ ok: true, action: 'fade', fadeTo: msg.fadeTo || 'black' }));
          break;
        default:
          ws.send(JSON.stringify({ error: 'Unknown message type. Use register, take, next, prev, cue, clear, fade.' }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ error: 'Invalid JSON or message format' }));
    }
  });
  ws.on('close', () => {
    if (registeredCode) {
      const entry = channelsByCode.get(registeredCode);
      if (entry?.wsClients) entry.wsClients.delete(ws);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Companion API http://localhost:${PORT} (HTTP + WebSocket)`);
  console.log('Deploy to Railway for SaaS. Same connection code as playout.');
});
