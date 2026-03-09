#!/usr/bin/env bash
# Netlify build script. Builds the site and the Windows download zip (same deploy = latest pages in both).
# In Netlify: Build & deploy > Build settings > Build command: bash netlify-build.sh
set -e
echo "=== Netlify build start ==="
npm install
npm run build
# SPA fallback: ensure dist has _redirects so /controller, /login etc. serve index.html (avoids 404 on refresh/direct URL)
echo "/*    /index.html   200" > dist/_redirects
echo "=== Building download zip (latest pages + server) ==="
node scripts/build-netlify-download.cjs
echo "=== Netlify build done ==="
