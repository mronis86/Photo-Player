-- Controller writes to companion_state while signed in (authenticated role).
-- Anon-only policies block authenticated users; add matching policies for authenticated.

create policy "Authenticated can read companion_state"
  on public.companion_state for select
  to authenticated
  using (true);

create policy "Authenticated can insert companion_state"
  on public.companion_state for insert
  to authenticated
  with check (true);

create policy "Authenticated can update companion_state"
  on public.companion_state for update
  to authenticated
  using (true)
  with check (true);
