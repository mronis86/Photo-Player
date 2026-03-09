/**
 * Standalone Companion API server (HTTP + WebSocket).
 *
 * Railway: For Netlify app + Bitfocus Companion, deploy ONLY this service on Railway.
 * The main API server (server/index.js) is not needed on Railway — the Netlify app
 * talks to Supabase for projects and companion state; Companion triggers hit this service.
 *
 * Run: npm run companion (or node companion/index.js)
 * For one-deployment (main app + Companion on same URL), the main server mounts mount.js instead.
 */
import 'dotenv/config';
import http from 'http';
import { companionApp, attachWs } from './mount.js';

const PORT = Number(process.env.PORT) || 3333;

const server = http.createServer(companionApp);
attachWs(server);
server.listen(PORT, () => {
  console.log(`Companion API (standalone) http://localhost:${PORT} (HTTP + WebSocket)`);
  console.log('Railway: this is the only service needed when the app is on Netlify.');
});
