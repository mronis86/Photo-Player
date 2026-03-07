@echo off
title Frameflow - Local Playout
cd /d "%~dp0"

REM Local playout: server runs here. Playout gets cloud (Supabase) + local files (temp-asset on this server).
REM - Controller on Netlify: cloud cues only (same connection code).
REM - Controller at this server (see URL below): cloud + local files. Across network: open controller at http://THIS_PC_IP:3000
REM - Playout on another PC: open http://THIS_PC_IP:3000/playout.html so local-file URLs resolve to this server.

echo Building the app...
call npm run build
if errorlevel 1 (
  echo Build failed. Run: npm install
  pause
  exit /b 1
)

echo.
echo Starting local server and opening playout...
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig 2^>nul ^| findstr /c:"IPv4"') do set "IP=%%a" & goto :ip_done
:ip_done
if defined IP set "IP=%IP:~1%"
if not defined IP set "IP=THIS_PC_IP"
set PUBLIC_SERVER_URL=http://%IP%:3000
echo Playout (this PC):   http://127.0.0.1:3000/playout.html
echo Playout (other PC):  http://%IP%:3000/playout.html  -- use this so local files work across network
echo Controller:          Open at http://127.0.0.1:3000 or http://%IP%:3000 (use IP for other browsers/PCs + local files)
echo.
echo Server listens on 0.0.0.0:3000 so other devices can connect. Temp-asset URLs use %IP% so playout can load from any browser/PC.
echo Press Ctrl+C to stop the server.
echo.

start "" "http://127.0.0.1:3000/playout.html"

set NODE_ENV=production
set PORT=3000
set LISTEN_HOST=0.0.0.0
node server/index.js

pause
