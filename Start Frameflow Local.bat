@echo off
title Frameflow Local Server
cd /d "%~dp0"

echo Building the app (controller + playout)...
call npm run build
if errorlevel 1 (
  echo Build failed. Run: npm install
  pause
  exit /b 1
)

echo.
echo Starting Frameflow Local Server...
echo.
echo Open in your browser:
echo   Controller: http://127.0.0.1:3000
echo   Playout:    http://127.0.0.1:3000/playout.html
echo.
echo Press Ctrl+C to stop the server.
echo.

start "" "http://127.0.0.1:3000"

set NODE_ENV=production
set PORT=3000
set LISTEN_HOST=0.0.0.0
node server/index.js

pause
