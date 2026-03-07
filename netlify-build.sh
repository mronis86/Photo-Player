#!/usr/bin/env bash
# Netlify build script. Run this so the site actually builds (avoids "Skipped").
# In Netlify: Build & deploy > Build settings > Build command: bash netlify-build.sh
set -e
echo "=== Netlify build start ==="
npm install
npm run build
echo "=== Netlify build done ==="
