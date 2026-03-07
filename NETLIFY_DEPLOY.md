# Netlify deploy – fix "Skipped" and get local playout feedback

## If Netlify shows "Skipped" for Building and Deploying

Netlify only runs a build when the site is set up to **build from your repo**. If everything is "Skipped", do this:

### 1. Connect the site to Git (if not already)

- Netlify **Site configuration** → **Build & deploy** → **Continuous deployment**
- **Link repository** and pick your repo/branch. Save.

### 2. Set build settings in the Netlify dashboard

- **Site configuration** → **Build & deploy** → **Build settings** → **Edit settings**
- **Build command:** set to exactly:
  ```bash
  bash netlify-build.sh
  ```
  (Or: `npm install && npm run build` if you prefer.)
- **Publish directory:** set to:
  ```
  dist
  ```
- **Build status:** make sure builds are **not** stopped (e.g. "Stop builds" should be off).
- Save.

### 3. Trigger a real build

- **Deploys** → **Trigger deploy** → **Clear cache and deploy site**
- Wait for the deploy. You should see **Building** (and logs), then **Deploying**. If it still says "Skipped", the Build command or Publish directory in step 2 may be wrong, or the site may be set to "Deploy without building".

---

## So the local playout gets feedback from the Netlify controller

The controller on Netlify talks to the local playout via **Supabase Realtime**. For that to work, the **Netlify build** must have your Supabase env vars so the built app can connect.

### 4. Set environment variables in Netlify

- **Site configuration** → **Environment variables** → **Add a variable** (or **Edit**)
- Add (use your real values; same as in `.env` locally):

  | Key | Value |
  |-----|--------|
  | `VITE_SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
  | `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

- **Scopes:** include **Builds** (and **Deploys** if you use serverless). Save.
- Trigger a **new deploy** (e.g. **Clear cache and deploy site**) so the new env vars are used in the build.

Without these, the Netlify app has no Supabase client, so the controller never joins the Realtime channel and the local playout never gets Take/stop/play.

---

## Quick checklist

- [ ] Repo linked; branch correct  
- [ ] Build command = `bash netlify-build.sh` (or `npm install && npm run build`)  
- [ ] Publish directory = `dist`  
- [ ] Builds not stopped  
- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set in Netlify env  
- [ ] **Clear cache and deploy site** run after changing env or build settings  

After that, the site should build on each deploy and the local playout should get feedback from the Netlify controller.
