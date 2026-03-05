/**
 * Backend API for image analysis. Uses Hugging Face via official SDK (correct router/URL).
 * Set HUGGING_FACE_TOKEN in .env — never exposed to the frontend.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import express from 'express';
import { imageSize } from 'image-size';
import { InferenceClient } from '@huggingface/inference';

const app = express();
app.use(express.json({ limit: '20mb' }));

// In-memory temp assets for local/hybrid playout (same network). Keyed by id, TTL 1 hour.
const TEMP_ASSET_TTL_MS = 60 * 60 * 1000;
const tempAssets = new Map(); // id -> { buffer, contentType, createdAt }

function cleanExpiredTempAssets() {
  const now = Date.now();
  for (const [id, entry] of tempAssets.entries()) {
    if (now - entry.createdAt > TEMP_ASSET_TTL_MS) tempAssets.delete(id);
  }
}

app.post('/api/temp-asset', (req, res) => {
  const raw = req.body?.image;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'Missing body.image (data URL or base64)' });
  }
  let buffer;
  let contentType = 'image/jpeg';
  try {
    if (raw.startsWith('data:')) {
      const match = raw.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        contentType = match[1].trim();
        buffer = Buffer.from(match[2].trim(), 'base64');
      } else {
        return res.status(400).json({ error: 'Invalid data URL' });
      }
    } else {
      buffer = Buffer.from(raw.trim(), 'base64');
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid image encoding' });
  }
  if (!buffer || buffer.length < 100) {
    return res.status(400).json({ error: 'Image data too small' });
  }
  if (buffer.length > 25 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image too large (max 25MB)' });
  }
  cleanExpiredTempAssets();
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  tempAssets.set(id, { buffer, contentType, createdAt: Date.now() });
  res.json({ id });
});

app.get('/api/temp-asset/:id', (req, res) => {
  const entry = tempAssets.get(req.params.id);
  if (!entry) {
    return res.status(404).send('Not found');
  }
  if (Date.now() - entry.createdAt > TEMP_ASSET_TTL_MS) {
    tempAssets.delete(req.params.id);
    return res.status(404).send('Expired');
  }
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(entry.buffer);
});

// Confirm temp-asset routes are loaded (so you know you restarted after adding them)
console.log('Temp asset API: POST /api/temp-asset, GET /api/temp-asset/:id (for local playout across browsers)');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const token = process.env.HUGGING_FACE_TOKEN?.trim() || null;
const hf = token ? new InferenceClient(token) : null;
// BLIP is not on any Inference Provider; use image classification (supported on hf-inference) for content labels
const HF_IMAGE_CLASSIFICATION_MODEL = 'google/vit-base-patch16-224';
const HF_OBJECT_DETECTION_MODEL = 'facebook/detr-resnet-50';

function compositionFromDimensions(w, h) {
  const ratio = w / h;
  const composition = ratio > 1.2 ? 'landscape' : ratio < 0.8 ? 'portrait' : 'square';
  const recommendedMode = composition === 'landscape' ? 'fullscreen' : composition === 'portrait' ? 'blurbg' : 'fullscreen';
  const recommendReason = composition === 'landscape'
    ? 'Wide image suits full screen.'
    : composition === 'portrait'
      ? 'Portrait works well with blur background.'
      : 'Square fits full screen.';
  const kbAnim = composition === 'landscape' ? 'pan-right' : 'zoom-in';
  const kbAnimReason = composition === 'landscape'
    ? 'Subtle pan suits wide frames.'
    : 'Zoom-in adds depth.';
  return { composition, recommendedMode, recommendReason, kbAnim, kbAnimReason };
}

/** From object-detection boxes (pixel coords) compute Ken Burns start/end in 0–100 view space. */
function customKbFramesFromDetections(detections, imgW, imgH) {
  if (!Array.isArray(detections) || detections.length === 0 || !imgW || !imgH) return null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Pick main subject: largest area * score; prefer person/animal
  const prefer = (label) => /person|cat|dog|bird|animal|face/i.test(label || '');
  const withArea = detections.map((d) => {
    const box = d.box || d;
    const xmin = box.xmin ?? 0;
    const ymin = box.ymin ?? 0;
    const xmax = box.xmax ?? xmin;
    const ymax = box.ymax ?? ymin;
    const area = (xmax - xmin) * (ymax - ymin);
    const score = typeof d.score === 'number' ? d.score : 0.9;
    return { ...d, xmin, ymin, xmax, ymax, area, score, preferred: prefer(d.label) };
  });
  withArea.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return b.area * b.score - a.area * a.score;
  });
  const main = withArea[0];
  if (!main) return null;
  const { xmin, ymin, xmax, ymax } = main;
  const bx = (xmin / imgW) * 100;
  const by = (ymin / imgH) * 100;
  const bw = ((xmax - xmin) / imgW) * 100;
  const bh = ((ymax - ymin) / imgH) * 100;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const padding = 1.4;
  let vw = Math.min(100, bw * padding);
  let vh = Math.min(100, bh * padding);
  if (vw < 15 || vh < 15) {
    vw = Math.max(15, vw);
    vh = Math.max(15, vh);
  }
  const viewX = clamp(cx - vw / 2, 0, 100 - vw);
  const viewY = clamp(cy - vh / 2, 0, 100 - vh);
  return {
    kbCustomStart: { x: 0, y: 0, w: 100, h: 100 },
    kbCustomEnd: { x: viewX, y: viewY, w: vw, h: vh },
  };
}


// Health check: verify app can reach the API and token is loaded
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    analysis: token ? 'on' : 'off',
    message: token ? 'API ready; token loaded.' : 'API ready but HUGGING_FACE_TOKEN not set.',
  });
});

app.get('/api/analyze-image', (req, res) => {
  res.status(405).json({
    error: 'Method not allowed',
    message: 'Use POST with JSON body: { "image": "<data URL or base64>" }',
  });
});

app.post('/api/analyze-image', async (req, res) => {
  console.log('[analyze-image] POST');
  if (!token) {
    return res.status(503).json({ error: 'Image analysis not configured (missing HUGGING_FACE_TOKEN)' });
  }
  const raw = req.body?.image;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'Missing body.image (base64 or data URL)' });
  }
  let buffer;
  try {
    const base64 = raw.includes('base64,') ? raw.split('base64,')[1].trim() : raw.trim();
    buffer = Buffer.from(base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid image encoding' });
  }
  if (buffer.length < 100) {
    return res.status(400).json({ error: 'Image data too small' });
  }
  let w = 1920, h = 1080;
  try {
    const dims = imageSize(buffer);
    if (dims?.width && dims?.height) {
      w = dims.width;
      h = dims.height;
    }
  } catch (_) {}
  const { composition, recommendedMode, recommendReason, kbAnim, kbAnimReason } = compositionFromDimensions(w, h);
  let caption = 'No caption';
  let source = 'fallback';
  let debugMessage = null;

  console.log('[analyze-image] Image size:', buffer.length, 'bytes, dimensions:', w, 'x', h);

  const imageType = raw.includes('image/png') ? 'image/png' : 'image/jpeg';
  const blob = new Blob([buffer], { type: imageType });

  if (hf) {
    try {
      console.log('[HF] Calling imageClassification, model:', HF_IMAGE_CLASSIFICATION_MODEL);
      const out = await hf.imageClassification({
        data: blob,
        model: HF_IMAGE_CLASSIFICATION_MODEL,
      });
      console.log('[HF] Raw response type:', typeof out, Array.isArray(out) ? 'length=' + out.length : '', JSON.stringify(out).slice(0, 300));
      const labels = Array.isArray(out) ? out : (out && out.length ? out : []);
      const top = labels.slice(0, 5).map((x) => (x && x.label) || x).filter(Boolean);
      if (top.length) {
        caption = 'Contains: ' + top.join(', ');
        source = 'huggingface';
        console.log('[HF] OK:', caption.slice(0, 70) + (caption.length > 70 ? '...' : ''));
      } else {
        debugMessage = 'HF returned no labels. Check server log for raw response.';
        console.warn('[HF] No labels in response:', typeof out, JSON.stringify(out).slice(0, 200));
      }
    } catch (e) {
      debugMessage = e.message || String(e);
      const status = e?.response?.status ?? e?.status;
      console.warn('[HF] Error:', e.message, status ? `(status ${status})` : '', e.stack?.slice(0, 200));
      if (Number(status) === 503) {
        console.warn('[HF] Model loading – wait ~30s and try again.');
      }
    }
  } else {
    debugMessage = 'No HF token (HUGGING_FACE_TOKEN not set in .env).';
  }

  let kbCustomStart = null;
  let kbCustomEnd = null;
  let finalKbAnim = kbAnim;
  let finalKbAnimReason = kbAnimReason;

  if (hf && source === 'huggingface') {
    try {
      const detections = await hf.objectDetection({
        data: blob,
        model: HF_OBJECT_DETECTION_MODEL,
      });
      const custom = customKbFramesFromDetections(detections, w, h);
      if (custom) {
        kbCustomStart = custom.kbCustomStart;
        kbCustomEnd = custom.kbCustomEnd;
        finalKbAnim = 'custom';
        finalKbAnimReason = 'Motion follows main subject.';
        console.log('[HF] Object detection: custom Ken Burns frames from', (detections || []).length, 'detections');
      }
    } catch (e) {
      console.warn('[HF] Object detection skipped:', e.message);
    }
  }

  const mood = 'neutral';
  const tags = source === 'huggingface' && caption.startsWith('Contains: ')
    ? [composition, ...caption.replace(/^Contains:\s*/, '').split(/,\s*/).slice(0, 6)]
    : [composition, ...caption.split(/\s+/).filter(s => s.length > 3).slice(0, 5)];
  res.json({
    analysis: {
      subject: caption,
      caption,
      mood,
      composition,
      recommendedMode,
      recommendReason,
      kbAnim: finalKbAnim,
      kbAnimReason: finalKbAnimReason,
      tags,
      source,
      debugMessage: debugMessage || undefined,
    },
    mode: recommendedMode,
    kbAnim: finalKbAnim,
    kbCustomStart: kbCustomStart || undefined,
    kbCustomEnd: kbCustomEnd || undefined,
  });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  const status = token ? 'on' : 'off';
  console.log('Frameflow API listening on http://localhost:' + port + ' (analysis: ' + status + ')');
  console.log('  → Local playout: ensure both Vite (dev) and this server are running; /api proxies to this port.');
});
