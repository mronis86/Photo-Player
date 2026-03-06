-- Companion state for Bitfocus Companion: one row per connection code.
-- Controller (webapp) upserts state here; Railway API reads it for GET /state so cues show in the module.
-- No Realtime or HTTP POST from browser to Railway required.

create table if not exists public.companion_state (
  connection_code text primary key,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.companion_state enable row level security;

-- Anon can read (Railway uses anon key to fetch state) and write (controller upserts from browser).
create policy "Anon can read companion_state"
  on public.companion_state for select
  using (true);

create policy "Anon can insert companion_state"
  on public.companion_state for insert
  with check (true);

create policy "Anon can update companion_state"
  on public.companion_state for update
  using (true)
  with check (true);

comment on table public.companion_state is 'State (cues, liveIndex, etc.) per connection code for Companion; written by controller, read by Railway API.';
