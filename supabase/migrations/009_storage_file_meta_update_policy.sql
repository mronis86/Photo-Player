-- Allow users to update their own storage_file_meta rows (required for upsert on save when re-uploading same path).
create policy "Users can update own storage_file_meta"
  on public.storage_file_meta for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
