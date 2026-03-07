@echo off
title Frameflow - Start Server + Netlify Playout
cd /d "%~dp0"

REM Local server runs in the background; playout opens on Netlify so it syncs with the Netlify controller (Supabase Realtime).
REM Edit the URL below to match your Netlify app.

set FRAMEFLOW_APP_URL=https://stupendous-alpaca-f588ad.netlify.app

for /f "tokens=2 delims=:" %%a in ('ipconfig 2^>nul ^| findstr /c:"IPv4"') do set "IP=%%a" & goto :ip_done
:ip_done
if defined IP set "IP=%IP:~1%"
if not defined IP set "IP=localhost"
set PUBLIC_SERVER_URL=http://%IP%:3000

echo Starting local server in a separate window (listening on 0.0.0.0:3000)...
start "Frameflow Local Server" cmd /k "cd /d "%~dp0" && set NODE_ENV=production && set PORT=3000 && set LISTEN_HOST=0.0.0.0 && set PUBLIC_SERVER_URL=%PUBLIC_SERVER_URL% && node server/index.js"

echo Waiting for server to bind...
timeout /t 2 /nobreak >nul

echo Opening Netlify playout in your browser...
start "" "%FRAMEFLOW_APP_URL%/playout.html"

echo.
echo Controller (cloud cues):  %FRAMEFLOW_APP_URL%/controller
echo Controller (local files): http://%IP%:3000  -- use this when taking local-image cues so playout can load them
echo Playout:                  Netlify (already opened) - syncs with either controller via same code
echo.
echo Close the "Frameflow Local Server" window to stop the server. See WHICH_BAT.md if unsure.
echo.
pause
