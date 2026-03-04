-- Store original file name for each cloud cue image so "Import from cloud" can show it.
-- One row per file; path = relative path stored in cue.src (e.g. "cues/abc.jpg").

create table if not exists public.storage_file_meta (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  original_name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, path)
);

alter table public.storage_file_meta enable row level security;

create policy "Users can read own storage_file_meta"
  on public.storage_file_meta for select
  using (auth.uid() = user_id);

create policy "Users can insert own storage_file_meta"
  on public.storage_file_meta for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own storage_file_meta"
  on public.storage_file_meta for delete
  using (auth.uid() = user_id);

create index if not exists storage_file_meta_user_path_idx on public.storage_file_meta (user_id, path);
