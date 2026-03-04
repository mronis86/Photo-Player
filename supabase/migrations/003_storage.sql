-- Storage bucket and RLS for project media (cue images).
-- Create the bucket in Dashboard first: Storage > New bucket > name "media", private.
-- Then run this migration to attach RLS so users only access their own folder (path = {user_id}/...).

-- RLS: users can only access objects in their own folder (path prefix = user_id)
create policy "Users can read own media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload own media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
