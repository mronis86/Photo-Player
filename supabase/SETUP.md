# Supabase setup: Auth, Projects, Storage

Run the migrations in order in the **Supabase SQL Editor** (Dashboard → SQL Editor → New query). Then create the storage bucket if the migration didn’t create it.

---

## 1. Sign up / Sign in (no extra “users” table)

Supabase Auth provides **sign up** and **sign in** out of the box using the built-in **`auth.users`** table. You do **not** create a separate “users” table for login.

- **Sign up**: `supabase.auth.signUp({ email, password })` inserts a row into `auth.users`.
- **Sign in**: `supabase.auth.signInWithPassword({ email, password })` checks `auth.users`.
- **Session**: Handled by Supabase (JWT, cookies). Your app uses `supabase.auth.getUser()` and `onAuthStateChange`.

So: **no SQL is required for sign up/sign in**. Ensure your project has **Auth** enabled (it is by default) and run the migrations below so that **projects** (and optionally **profiles**) are wired to `auth.uid()`.

---

## 2. Run migrations in order

Execute each migration file in this order:

| Order | File | Purpose |
|-------|------|--------|
| 1 | `001_projects.sql` | `public.projects` table + RLS (user-scoped projects) |
| 2 | `002_profiles.sql` | Optional `public.profiles` + trigger on signup |
| 3 | `003_storage.sql` | Storage bucket `media` + RLS for user media |

### After running the SQL

1. **Storage bucket (fixes "bucket not found")**  
   Create the **`media`** bucket:
   - In Supabase Dashboard go to **Storage** → **New bucket**.
   - **Name:** `media` (exactly).
   - **Public:** off (private).
   - Save. Optionally set file size limit (e.g. 50 MB) and allowed MIME types (`image/jpeg`, `image/png`, `image/gif`, `image/webp`).
   - The app will try to create this bucket automatically on first upload; if you see "bucket not found", create it manually as above.

2. **Auth settings** (optional)  
   Under **Authentication** → **Providers**, enable **Email** (and confirm “Confirm email” if you want). Under **URL Configuration**, add your app URL for redirects.

---

## 3. Tables overview

| Table / feature | Purpose |
|-----------------|--------|
| **auth.users** (Supabase) | Sign up / sign in. Do not modify; used by Auth. |
| **public.profiles** | Optional: display name, avatar URL. Row created on signup via trigger. |
| **public.projects** | One row per project; `user_id` = `auth.uid()`, `payload` = JSON (cues, groups, cueItems). |
| **storage.buckets** | One bucket **`media`** for user-uploaded images. |
| **storage.objects** | Files in `media`; RLS so users only access paths under `{user_id}/...`. |

---

## 4. Upload path convention

Store files under the **`media`** bucket with paths like:

- **`{user_id}/{file_name}`**  
  e.g. `a1b2c3d4-.../photo.jpg`

RLS in `003_storage.sql` allows each user to read/insert/update/delete only objects whose path starts with their own `auth.uid()`.

---

## 5. Env vars (frontend)

In your app (e.g. `.env`):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get these from **Project settings** → **API** in the Supabase Dashboard.
