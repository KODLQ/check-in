-- Public-read buckets. Object paths are "<user id>/<random uuid>.<ext>", so they
-- are unguessable and only the owner can write into their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('covers', 'covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "covers/avatars: owner can upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('covers', 'avatars')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "covers/avatars: owner can update"
on storage.objects for update
to authenticated
using (
  bucket_id in ('covers', 'avatars')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "covers/avatars: owner can delete"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('covers', 'avatars')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
