/**
 * Frameflow Local App — Electron launcher.
 *
 * Two modes:
 * 1. FRAMEFLOW_APP_URL set (e.g. https://your-app.netlify.app): just open a playout browser.
 *    Controller = web (Netlify). User runs this app to open playout; they connect via code (Realtime) or same-origin.
 * 2. FRAMEFLOW_APP_URL not set: run Node server + open controller/playout at localhost (local files, full stack).
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.FRAMEFLOW_APP_URL || '').trim().replace(/\/+$/, '');
const PLAYOUT_ONLY_MODE = APP_URL.length > 0;
// When packaged, server is unpacked (asarUnpack); run from there so Node can execute it
function getBaseDir() {
  try {
    const appPath = app.getAppPath();
    if (appPath.includes('app.asar')) {
      return appPath.replace('app.asar', 'app.asar.unpacked');
    }
  } catch (_) {}
  return path.join(__dirname, '..');
}
let BASE_DIR = path.join(__dirname, '..');
let SERVER_PATH = path.join(BASE_DIR, 'server', 'index.js');

let serverProcess = null;
let launcherWindow = null;

function getLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      LISTEN_HOST: '0.0.0.0',
    };
    serverProcess = spawn(process.execPath || 'node', [SERVER_PATH], {
      cwd: BASE_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    serverProcess.stdout.on('data', (chunk) => {
      const msg = chunk.toString();
      if (!resolved && (msg.includes('listening') || msg.includes('Frameflow'))) {
        resolved = true;
        resolve();
      }
    });
    serverProcess.stderr.on('data', (chunk) => {
      const msg = chunk.toString();
      if (!resolved && msg.includes('listening')) {
        resolved = true;
        resolve();
      }
    });
    serverProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error('Server exited with code', code);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 1500);
  });
}

function createPlayoutOnlyWindow() {
  const playoutUrl = `${APP_URL}/playout.html`;
  const controllerUrl = APP_URL;

  launcherWindow = new BrowserWindow({
    width: 420,
    height: 280,
    title: 'Frameflow Playout',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    autoHideMenuBar: true,
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Frameflow Playout</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0; padding: 20px; background: #0d0d0d; color: #e0e0e0;
      min-height: 100vh; display: flex; flex-direction: column;
    }
    h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 8px 0; color: #fff; }
    p { font-size: 12px; color: #888; margin: 0 0 16px 0; line-height: 1.5; }
    .btns { display: flex; flex-direction: column; gap: 8px; }
    a { color: #4a9eff; text-decoration: none; padding: 10px 14px; background: #1a2a3a; border-radius: 6px; text-align: center; }
    a:hover { background: #243a4a; }
  </style>
</head>
<body>
  <h1>Frameflow Playout</h1>
  <p>Use the controller in your browser at the web app. This opens the playout so you can connect with the connection code.</p>
  <div class="btns">
    <a href="${playoutUrl}" id="open-playout">Open playout (browser)</a>
    <a href="${controllerUrl}" id="open-controller">Open controller (web)</a>
  </div>
</body>
</html>
  `;

  launcherWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  launcherWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  launcherWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
  });
}

function createLauncherWindow() {
  const localUrl = `http://127.0.0.1:${PORT}`;
  const ips = getLocalIps();
  const networkUrl = ips.length ? `http://${ips[0]}:${PORT}` : null;

  launcherWindow = new BrowserWindow({
    width: 420,
    height: 340,
    title: 'Frameflow Local',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    autoHideMenuBar: true,
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Frameflow Local</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0; padding: 20px; background: #0d0d0d; color: #e0e0e0;
      min-height: 100vh; display: flex; flex-direction: column;
    }
    h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 16px 0; color: #fff; }
    .url { font-family: ui-monospace, monospace; font-size: 12px; background: #1a1a1a; padding: 8px 10px; border-radius: 6px; margin-bottom: 16px; word-break: break-all; }
    .url span { color: #888; }
    .btns { display: flex; flex-direction: column; gap: 8px; }
    a { color: #4a9eff; text-decoration: none; padding: 10px 14px; background: #1a2a3a; border-radius: 6px; text-align: center; }
    a:hover { background: #243a4a; }
    .same-network { margin-top: auto; padding-top: 16px; border-top: 1px solid #222; font-size: 11px; color: #888; }
  </style>
</head>
<body>
  <h1>Frameflow Local Server</h1>
  <p class="url"><span>This computer:</span><br>${localUrl}</p>
  ${networkUrl ? `<p class="url"><span>Same network (other devices):</span><br>${networkUrl}</p>` : ''}
  <div class="btns">
    <a href="${localUrl}" id="open-controller">Open controller</a>
    <a href="${localUrl}/playout.html" id="open-playout">Open playout</a>
  </div>
  <p class="same-network">Local files and playout use this server. Close this window to stop the server.</p>
</body>
</html>
  `;

  launcherWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  launcherWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  launcherWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
  });
}

app.whenReady().then(async () => {
  if (PLAYOUT_ONLY_MODE) {
    createPlayoutOnlyWindow();
    return;
  }
  BASE_DIR = getBaseDir();
  SERVER_PATH = path.join(BASE_DIR, 'server', 'index.js');
  try {
    await startServer();
    createLauncherWindow();
  } catch (err) {
    console.error('Failed to start server:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
