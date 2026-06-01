drop policy if exists "users see own docs" on documents;
drop policy if exists "users see own chunks" on chunks;
drop policy if exists "users see own feedback" on feedback;

create policy "users manage own docs" on documents
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "users manage own chunks" on chunks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "users manage own feedback" on feedback
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
