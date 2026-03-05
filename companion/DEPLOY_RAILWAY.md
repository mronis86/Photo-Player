# Deploy Companion to Railway via GitHub

When you push to the **main** branch on GitHub, Railway will automatically rebuild and redeploy the companion service. Follow these steps once to set it up.

---

## 1. Push your repo to GitHub

- If the project isn’t on GitHub yet: create a new repo on [github.com](https://github.com), then from your project folder:
  ```bash
  git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
  git push -u origin main
  ```
- If it’s already on GitHub, make sure your latest code (including the `companion` folder) is pushed to the **main** branch.

---

## 2. Open Railway and sign in

- Go to [railway.app](https://railway.app) and sign in (GitHub login is easiest).

---

## 3. Create a new project from GitHub

1. Click **“New Project”**.
2. Choose **“Deploy from GitHub repo”** (or “Deploy from GitHub”).
3. If asked to install the Railway GitHub app, authorize it and select the **repository** that contains this project (the one with the `companion` folder).
4. Select the repo and confirm. Railway will create a new project and may add a first service from the repo.

---

## 4. Use only the `companion` folder (Root Directory)

Railway needs to treat only the `companion` folder as this service, not the whole repo.

1. In the project, open the **service** that was created (or add a new one and choose “GitHub repo” and select the same repo).
2. Go to the service **Settings** (gear or “Settings” tab).
3. Find **“Source”** or **“Build”**.
4. Set **Root Directory** to:
   ```text
   companion
   ```
   (Exactly that: the folder name, no leading slash.)
5. Save if there’s a save button.

So: same repo, same branch (e.g. `main`); this service only builds and runs from the `companion` directory.

---

## 5. Set environment variables

1. In the same service, open the **Variables** tab (or “Environment” / “Env”).
2. Add two variables (use the same values as your main app / `.env`):

   | Name               | Value                    |
   |--------------------|--------------------------|
   | `SUPABASE_URL`     | Your Supabase project URL |
   | `SUPABASE_ANON_KEY`| Your Supabase anon key   |

3. Save. Railway will redeploy if it was already building.

---

## 6. Get the public URL

1. In the service, go to **Settings** → **Networking** (or “Deploy” / “Public Networking”).
2. Click **“Generate Domain”** (or “Add domain”). Railway will assign a URL like:
   ```text
   https://your-service-name-production-xxxx.up.railway.app
   ```
3. Copy that base URL. You’ll use it in Companion:
   - **HTTP:** `https://your-url.up.railway.app/take?code=AB12XY`, `/state?code=AB12XY`, etc.
   - **WebSocket:** `wss://your-url.up.railway.app` (then send `{ "type": "register", "code": "AB12XY" }`).

---

## 7. Confirm it’s running

- Open in a browser: `https://your-url.up.railway.app/health`  
  You should see something like: `{"ok":true,"service":"frameflow-companion-api"}`.
- In your app, open the controller, note the connection code (e.g. `AB12XY`), then try:  
  `https://your-url.up.railway.app/state?code=AB12XY`  
  You should get JSON (state or empty cues if nothing is loaded).

---

## 8. How updates work

- **Automatic redeploys:** Railway is connected to your GitHub repo. Whenever you **push to the branch** you connected (usually `main`), Railway will:
  1. Pull the latest code.
  2. Build only the `companion` folder (Dockerfile there).
  3. Deploy the new version.

- You don’t need to run any deploy command; push to GitHub and Railway updates the companion server.

- To change which branch deploys: Service → **Settings** → **Source** → set the **Branch** (e.g. `main`).

---

## Quick checklist

- [ ] Repo is on GitHub and `main` (or your branch) is up to date.
- [ ] Railway project created from that GitHub repo.
- [ ] **Root Directory** set to `companion` for this service.
- [ ] `SUPABASE_URL` and `SUPABASE_ANON_KEY` set in Variables.
- [ ] Domain generated and URL copied for Companion (HTTP + WebSocket).

After that, pushing updates to main will update Railway automatically.
