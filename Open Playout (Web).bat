@echo off
title Frameflow - Playout Only (Netlify)
REM Opens the playout (stage only) at your Netlify URL. Use the controller in another tab at the same URL.
REM After updating the app: npm run build:netlify, then deploy the netlify folder to Netlify.
REM Edit the URL below to match your Netlify app.

set FRAMEFLOW_APP_URL=https://stupendous-alpaca-f588ad.netlify.app

start "" "%FRAMEFLOW_APP_URL%/playout.html"
