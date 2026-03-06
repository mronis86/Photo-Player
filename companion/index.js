/**
 * Standalone Companion API server. For one-deployment (main app + Companion), the main server mounts companion/mount.js instead.
 * Run: npm run companion (or from repo root: node companion/index.js)
 */
import 'dotenv/config';
import http from 'http';
import { companionApp, attachWs } from './mount.js';

const PORT = Number(process.env.PORT) || 3333;

const server = http.createServer(companionApp);
attachWs(server);
server.listen(PORT, () => {
  console.log(`Companion API (standalone) http://localhost:${PORT} (HTTP + WebSocket)`);
  console.log('For one Railway deploy, use the main app root instead; it mounts Companion on the same server.');
});
