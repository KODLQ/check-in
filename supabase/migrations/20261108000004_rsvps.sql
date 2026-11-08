create type public.rsvp_status as enum ('going', 'maybe', 'declined');

create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  -- SHA-256 (hex) of the guest's device token. The raw token is never stored.
  guest_token_hash text check (guest_token_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
  status public.rsvp_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rsvps_one_identity check ((user_id is null) <> (guest_token_hash is null)),
  constraint rsvps_unique_user unique (event_id, user_id),
  constraint rsvps_unique_guest unique (event_id, guest_token_hash)
);

create index rsvps_event_idx on public.rsvps (event_id, status);

create trigger rsvps_updated_at
before update on public.rsvps
for each row execute function public.set_updated_at();

alter table public.rsvps enable row level security;

-- Writes happen only through security-definer functions (upsert_rsvp, rsvp_as_user)
-- so that invite-token, closed-event and rate-limit rules can't be bypassed.
create policy "rsvps: host or self can read"
on public.rsvps for select
to authenticated
using (public.is_event_host(event_id) or user_id = (select auth.uid()));

create policy "rsvps: host or self can delete"
on public.rsvps for delete
to authenticated
using (public.is_event_host(event_id) or user_id = (select auth.uid()));

-- Live guest list for hosts.
alter publication supabase_realtime add table public.rsvps;
