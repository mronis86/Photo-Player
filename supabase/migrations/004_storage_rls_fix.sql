-- Fix storage RLS so uploads succeed (fixes "new row violates row-level security policy").
-- Uses (auth.jwt()->>'sub') which is reliable in storage context; path must start with that id.

drop policy if exists "Users can read own media" on storage.objects;
drop policy if exists "Users can upload own media" on storage.objects;
drop policy if exists "Users can update own media" on storage.objects;
drop policy if exists "Users can delete own media" on storage.objects;

-- User id from JWT (same as auth.uid() but works in storage RLS)
create policy "Users can read own media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (name = (auth.jwt()->>'sub') or name like ((auth.jwt()->>'sub') || '/%'))
  );

create policy "Users can upload own media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (name = (auth.jwt()->>'sub') or name like ((auth.jwt()->>'sub') || '/%'))
  );

create policy "Users can update own media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'media'
    and (name = (auth.jwt()->>'sub') or name like ((auth.jwt()->>'sub') || '/%'))
  );

create policy "Users can delete own media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (name = (auth.jwt()->>'sub') or name like ((auth.jwt()->>'sub') || '/%'))
  );
