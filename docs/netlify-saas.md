# Hosting on Netlify as a SaaS Web App

## How it works today

Your **netlify.toml** is set up to build and publish the **static** app only:

- **Build:** `npm run build` → Vite builds the frontend into `dist/`
- **Publish:** `dist` (Netlify serves those files)
- **Redirect:** `/*` → `/index.html` so client-side routing works (existing files like `/playout.html` are still served as-is)

So on Netlify you get **only the frontend**. There is **no long-lived Node server** (no Express, no `/api/*`).

## What works on Netlify (no backend)

- **Auth** – Supabase Auth (browser talks to Supabase)
- **Projects** – Supabase DB (projects, companion code, etc.)
- **Cloud cues** – Images in Supabase Storage; app uses signed URLs. Controller and playout both work.
- **Realtime playout** – Supabase Realtime for controller ↔ playout (connection code, cross-device).
- **Companion** – Uses Supabase Realtime (and optional Companion API elsewhere). No server needed on Netlify for that.

So the **SaaS “cloud-only”** flow works: users sign in, use projects, cloud cues, and Realtime playout from the Netlify URL. No API on Netlify required.

## What does *not* work on Netlify (without changes)

- **Local files (data URL / blob) for playout**  
  The app uploads them to `/api/temp-asset` so playout can load by URL. That endpoint is your **Node server** (Express, in-memory store). Netlify does not run that server, so:
  - From the Netlify site, local-file playout will fail (404 on `/api/temp-asset`).
- **Image analysis**  
  `/api/analyze-image` (Hugging Face) also lives on that same Node server, so it won’t exist on Netlify unless you add it as a serverless function.

So: **Netlify = static site only.** Your existing Node API (temp-asset + analyze) is not deployed there.

## Two ways to run the product

### 1. SaaS on Netlify (web only)

- **URL:** `https://your-app.netlify.app` (or your domain).
- **Works:** Auth, projects, cloud cues, Realtime playout, Companion (Realtime).
- **Does not work:** Local-file playout, image analysis (unless you add Netlify Functions; see below).
- **User story:** “Use the web app in the browser; all media is in the cloud (Supabase).”

### 2. Local app (Electron or batch)

- **What it is:** The app you built that runs the Node server and serves the same frontend (or opens it in the browser).
- **URL:** `http://localhost:3000` (or “Same network” URL).
- **Works:** Everything, including **local files** and **image analysis** (with `HUGGING_FACE_TOKEN`).
- **User story:** “Run the local app when you want fast local/same-network playout and optional image analysis.”

So:

- **Netlify** = SaaS web app (cloud-only, no temp-asset, no analyze unless you add functions).
- **Local app / batch** = full experience (temp-asset + optional analyze).

You can document it as: “Use the web app for cloud-only; use the desktop/batch app for local files and best performance.”

## Optional: Add APIs on Netlify (serverless)

If you want **some** backend behavior on Netlify:

- **Netlify Functions** can implement:
  - `POST /api/temp-asset` – accept base64/image, store somewhere (e.g. ephemeral blob or small cache), return an ID.
  - `GET /api/temp-asset/:id` – return that image (or 404).
  - `POST /api/analyze-image` – call Hugging Face with `HUGGING_FACE_TOKEN` (set in Netlify env).

Limitations:

- **Request size / timeout** – e.g. 6 MB request body, 10–26 s timeout (depending on plan). Large images may need resizing or a different strategy.
- **Temp-asset storage** – Functions are stateless; you’d need a store (e.g. Supabase Storage with short-lived keys, or a small cache service) and possibly a different URL shape than the current in-memory Map.

So “host on Netlify as a SaaS server web app” today means: **the server is the static site + Supabase.** The “server” for temp-asset and analyze stays either on the **local app** or on a **separate backend** (e.g. Railway), unless you reimplement those as Netlify Functions and optional storage.

## Summary

| Feature              | Netlify (static only) | Local app / batch   |
|----------------------|------------------------|---------------------|
| Auth & projects      | Yes (Supabase)        | Yes                 |
| Cloud cues + playout | Yes                   | Yes                 |
| Realtime playout     | Yes                   | Yes                 |
| Local-file playout   | No (no /api)          | Yes (temp-asset)    |
| Image analysis       | No (no /api)          | Yes (with token)    |

**How it will work:** Deploy the current build to Netlify for the SaaS web app (cloud + Realtime). For local files and analysis, users run the local server app or batch; the same frontend can point at that server when they use it.
