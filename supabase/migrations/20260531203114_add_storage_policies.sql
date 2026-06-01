drop policy if exists "users view own document objects" on storage.objects;
drop policy if exists "users upload own document objects" on storage.objects;
drop policy if exists "users update own document objects" on storage.objects;
drop policy if exists "users delete own document objects" on storage.objects;

create policy "users view own document objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "users upload own document objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "users update own document objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "users delete own document objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
