# Local development

## Project save/load: use the API server (avoids CORS / 500 to Supabase)

The browser can hit CORS or 500 when calling Supabase’s REST API directly. So **project save, load, list, and delete** go through your **API server** (local or Railway). The server calls Supabase with your auth token; the browser only talks to the server.

- **Local:** Run the API server and the app:
  1. `npm run server` (port 3001)
  2. `npm run dev` (Vite proxies `/api` to 3001)

  In dev the app uses `USE_PROJECTS_API` and sends project requests to `/api/projects/...`, which the proxy forwards to your server. The server needs Supabase in `.env` (same as frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, or `SUPABASE_URL` / `SUPABASE_ANON_KEY`).

- **Production (e.g. frontend on Netlify, API on Railway):** Set `VITE_API_BASE` to your Railway API URL so the frontend calls Railway for projects. Railway then talks to Supabase (no CORS).

## React Router future flags

The app enables `v7_startTransition` and `v7_relativeSplatPath` so React Router v7 upgrade warnings do not appear in the console.
