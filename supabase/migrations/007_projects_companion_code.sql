-- Permanent Companion connection code per project. Used for companion_state and Companion module.
-- When a project is open, the controller uses this code for Companion; each project keeps the same code.

alter table public.projects
  add column if not exists companion_code text;

-- Backfill existing rows with a deterministic 6-char code (hex)
update public.projects
  set companion_code = upper(substring(md5(id::text) from 1 for 6))
  where companion_code is null;

alter table public.projects
  alter column companion_code set not null;

create unique index if not exists projects_companion_code_key
  on public.projects (companion_code);

comment on column public.projects.companion_code is 'Permanent 6-char code for this project; used for Companion and companion_state table.';
