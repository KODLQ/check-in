-- Guest capacity (change: add-guest-capacity), migration A.
-- A new enum value cannot be used in the transaction that adds it, so it gets its own migration.
alter type public.rsvp_status add value if not exists 'waitlisted';
