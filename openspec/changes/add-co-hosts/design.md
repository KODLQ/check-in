# Design

## Context

See proposal.md for motivation and `specs/` for required behavior. Current state (migrations `20261108000001`–`07`):

- Authorization is single-owner. `events` policies use `host_id = auth.uid()`; `event_invites` and `rsvps` use `is_event_host(event_id)` (security definer, owner-only); `regenerate_invite` checks `is_event_host`.
- Cancel is a plain `update events set cancelled_at = …` from the app, so "owner-only cancel" cannot be expressed by the `events` UPDATE policy alone once co-hosts can update.
- Covers are uploaded to `covers/<uploader uid>/<uuid>.<ext>`; storage policies only allow writing to your own folder. `delete-account` deletes the caller's `covers/<uid>/` folder, so a cover a co-host uploaded would vanish when that co-host deletes their account.
- `get_invite` returns a single `host` object; the web page and OG card render `hosted_by` with one name.
- The app's event list is `select *, rsvps(status) from events` and relies on RLS for scoping; the live guest list is Realtime `postgres_changes` on `rsvps`, which applies the `rsvps` SELECT policy per subscriber.
- Profiles are readable only by their owner.

## Goals / Non-Goals

**Goals:**
- One membership-aware authorization helper used by every policy and RPC that today means "the host", with an explicit owner-only helper for the owner-only actions.
- Owner-only rules enforced in Postgres, not only hidden in the UI.
- Removal/leave takes effect on the very next query and Realtime message.

**Non-Goals:**
- Changing guest-facing access rules (guests still only use token-keyed functions).
- A generic roles/permissions table.
- Backfilling or migrating existing cover objects.

## Decisions

### 1. Permission matrix

| Action | Owner | Co-host | Enforced by |
|---|---|---|---|
| Read event, invite link, full guest list (incl. Can't go), live updates | ✓ | ✓ | `events`/`event_invites`/`rsvps` SELECT policies (`is_event_manager`) |
| Edit details, cover, `guest_list_visible` | ✓ | ✓ | `events` UPDATE policy + `events_guard` |
| Share / copy invite link | ✓ | ✓ | (read access) |
| Regenerate invite link | ✓ | ✓ | `regenerate_invite` (`is_event_manager`) |
| Remove guest | ✓ | ✓ | `rsvps` DELETE policy |
| See co-host list | ✓ | ✓ | `list_event_hosts` RPC |
| Cancel / un-cancel | ✓ | ✗ | `events_guard` (owner check on `cancelled_at` change) |
| Delete event | ✓ | ✗ | `events` DELETE policy (unchanged, `host_id = auth.uid()`) |
| Create / revoke co-host links, remove co-host | ✓ | ✗ | RPCs check `is_event_owner` |
| Leave | – | ✓ | `leave_event` RPC / `event_co_hosts` DELETE policy (`user_id = auth.uid()`) |
| Post announcements (`add-guest-updates`), moderate wall (`add-event-wall`) | ✓ | ✓ | Sibling changes; must use `is_event_manager` |

**Why co-hosts may regenerate the guest link:** a leak is time-critical and the co-host who shared the link is often the one who notices. **Why cancel is owner-only:** it is irreversible from a guest's point of view (guests are told the event is off) and the owner is accountable for the event; co-hosts can still edit. Alternative considered: co-hosts may cancel — rejected as the bigger blast radius for a role that requires no trust check beyond a link.

### 2. Data model

| Table | Columns | Notes |
|---|---|---|
| `event_co_hosts` | `event_id` → events (cascade), `user_id` → profiles (cascade), `added_at`, PK (`event_id`,`user_id`) | Index on `user_id` for the event list. Trigger rejects `user_id = events.host_id`. |
| `co_host_invites` | `token text` PK (22 chars base62 ≈ 131 bits), `event_id` → events (cascade), `created_at`, `expires_at` (default `now() + 7 days`), `revoked_at`, `accepted_by` → profiles (`on delete set null`), `accepted_at` | One row per link. "Pending" = `accepted_at is null and revoked_at is null and expires_at > now()`. |

Token: generalize `generate_invite_token()` into `generate_random_token(p_length int)` (same rejection sampling) and keep the 12-char wrapper for guest links. 22 chars because a co-host link grants write access, and it can never match the guest-link regex `^[A-Za-z0-9]{12}$`, so it is never mistaken for one. Tokens live in a separate table and a separate URL path (`/c/<token>`), never in `event_invites`.

Alternative considered: a `role` column on a generic `event_members` table including the owner. Rejected: `events.host_id` is already the owner and is referenced by cascades, deletion and the existing `host_immutable` guard; duplicating it creates two sources of truth. Ownership transfer (out of scope) can later update `host_id`.

### 3. Helpers (all `security definer`, `stable`, `set search_path = ''`, execute revoked from `public, anon`)

- `is_event_owner(event_id)` – `events.host_id = auth.uid()`. Same body as today's `is_event_host`.
- `is_event_co_host(event_id)` – exists in `event_co_hosts` for `auth.uid()`. Queries only `event_co_hosts`, so it can be used inside the `events` policies without recursion.
- `is_event_manager(event_id)` – owner or co-host.
- `is_event_host` is kept as an owner-only alias (`= is_event_owner`) so nothing that still references it silently widens; no policy in this repo uses it after this change. Sibling changes must use `is_event_manager` for manager rights.

### 4. Policies that change

| Object | Policy (today) | After |
|---|---|---|
| `events` | "host can read" `host_id = uid` | "managers can read": `host_id = uid or is_event_co_host(id)` |
| `events` | "host can update" | "managers can update": same expression in `using` and `with check` |
| `events` | "host can create", "host can delete" | **unchanged** (owner only) |
| `event_invites` | "host can read/create/revoke" (`is_event_host`) | "managers can read/create/revoke" (`is_event_manager`) |
| `rsvps` | "host or self can read/delete" (`is_event_host`) | "manager or self can read/delete" (`is_event_manager`) |
| `storage.objects` | owner folder insert/update/delete | unchanged, **plus** "covers: managers can upload to event folder" (insert only) |
| `profiles` | owner can read/update | **unchanged**; co-host names reach managers only via `list_event_hosts` and guests only via `get_invite` |

New tables:

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `event_co_hosts` | `is_event_manager(event_id)` | none (only `accept_co_host_invite`) | none | `is_event_owner(event_id) or user_id = auth.uid()` |
| `co_host_invites` | `is_event_owner(event_id)` | none (only `create_co_host_invite`) | none (only `revoke_co_host_invite`) | none |

No `anon` policy on any of these. Guests' only path remains `get_invite` / `upsert_rsvp` / `withdraw_rsvp`.

Realtime: no publication change. `rsvps` is already published; Realtime evaluates the new SELECT policy per change, so co-hosts receive updates and a removed co-host stops receiving them on the next change. `event_co_hosts` is not added to the publication; the app treats an empty reload (event not found) as "no longer a co-host" (see §8), and reloads on focus and on every `rsvps` change it still receives.

### 5. Function and trigger changes

- `events_guard` (UPDATE): if `new.cancelled_at is distinct from old.cancelled_at` and `auth.uid()` is not `old.host_id` → raise `owner_only`. Also validate `cover_path` when it changes: must be null, start with `<auth.uid()>/`, or start with `e/<event id>/` — stops a co-host from pointing the cover at arbitrary objects. Service role / `auth.uid() is null` (retention, admin) bypasses the owner check.
- `regenerate_invite`: `is_event_host` → `is_event_manager`.
- `create_co_host_invite(event_id) returns text`: owner only; event not ended/cancelled; locks the event row (`for update`) and counts co-hosts + pending links < 5, else `co_host_limit`.
- `revoke_co_host_invite(token)`: owner only; sets `revoked_at`.
- `get_co_host_invite(token) returns jsonb`: authenticated only; returns `{state: valid|invalid|owner|already_co_host, event: {id, title}, owner: {display_name}}`. All invalid cases (unknown, expired, revoked, used, cancelled, ended) return the same `{state:'invalid'}`.
- `accept_co_host_invite(token) returns uuid` (event id): requires `auth.uid()` and a profile `display_name`; locks the invite row and the event row; re-validates; rejects owner; no-op for existing co-host (link not consumed); checks co-host count < 5 (`co_host_limit`); inserts membership; sets `accepted_by`, `accepted_at`.
- `leave_event(event_id)`: deletes the caller's membership.
- `remove_co_host(event_id, user_id)`: owner only.
- `list_event_hosts(event_id) returns table(user_id, display_name, avatar_path, role, added_at)`: managers only; owner first, then co-hosts by `added_at`.
- `get_invite`: adds `'co_hosts': [{display_name}]` ordered by `added_at` (owner stays in `host`). Only display names — no ids or avatars.
- `run_retention`: also deletes `co_host_invites` 30 days after they expired, were revoked or accepted.

A public web lookup for co-host links (`get_co_host_invite_preview(token)`, service role only, returns title + owner name or invalid) feeds the `/c/[token]` landing page and its OG metadata. It never returns location, time or guests.

### 6. Covers uploaded by co-hosts

Covers chosen in the **edit** screen (owner or co-host) upload to `covers/e/<event_id>/<uuid>.<ext>`. New storage policy:

```sql
create policy "covers: managers can upload to event folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'covers'
  and (storage.foldername(name))[1] = 'e'
  and public.is_event_manager(public.try_uuid((storage.foldername(name))[2]))
);
```

`try_uuid` returns null on malformed input so a bad path fails the check instead of erroring. No update/delete policy for event folders: object names are random, and cleanup runs with the service role. The create flow keeps uploading to the creator's own folder (no event id exists yet).

**Why:** the cover belongs to the event, not the uploader, so a co-host deleting their account must not break the owner's event. Alternative considered: copying the co-host's object into the owner's folder during account deletion — rejected as fragile (partial failures leave broken covers) and it moves one person's upload under another's id.

### 7. Account deletion (`delete-account` Edge Function)

1. Before deleting the user, list events where `host_id = user` and remove each `covers/e/<event_id>/` folder (owned events are about to be deleted).
2. Remove `covers/<uid>/` and `avatars/<uid>/` as today. A co-host's earlier uploads only live in `e/<event_id>/` if made via edit, so co-hosted events keep their covers.
3. `auth.admin.deleteUser` cascades: `profiles` → owned `events` → `event_invites`, `rsvps`, `event_co_hosts`, `co_host_invites` of those events; and `profiles` → the user's own `event_co_hosts` rows (co-host memberships removed, events stay); `co_host_invites.accepted_by` → null.

Owner deletion therefore deletes the event for its co-hosts too (spec: user-accounts).

### 8. App and web

- **Event list:** query unchanged (RLS widens it); label "Co-host" when `host_id !== session.user.id`.
- **Event detail:** derive `isOwner`. Co-hosts don't see Cancel, Delete or co-host management; they see "Leave as co-host". Owners get a "Hosts" section: list from `list_event_hosts`, "Invite co-host" (create link → share sheet), pending links with Revoke, remove co-host. When a reload returns no event (removed/left/deleted), show "You're no longer a co-host of this event" and go back.
- **Accept route** `apps/mobile/src/app/c/[token].tsx`: requires session (redirect through sign-in with return path), requires display name (onboarding), calls `get_co_host_invite` then `accept_co_host_invite`.
- **Web** `apps/web/src/app/c/[token]/page.tsx`: minimal page — "{Owner} invited you to co-host {title}", Open in app / App Store / Google Play. `.well-known` files add `/c/*`.
- **Hosted-by text:** shared helper `formatHostNames(owner, coHosts, locale)` using `Intl.ListFormat` (`sv`: "Anna, Erik och Sara"; `en`: "Anna, Erik & Sara" via custom conjunction), used by invite page, OG image and `generateMetadata`.

### 9. Integration points

- `add-guest-updates` (announcements, notifications): posting an announcement should be allowed for `is_event_manager`. Notifying co-hosts about RSVPs is that change's decision.
- `add-event-wall`: moderation (hide/delete posts) should use `is_event_manager`.
- `add-guest-capacity`, `add-date-polls`: any host-side setting they add should default to `is_event_manager` unless it is destructive like cancel.
- `add-my-invites`: an event a user co-hosts should appear in the hosting list, not in "my invites".

Whichever of these lands second must update the other's helper references; pgTAP should cover a co-host case for each.

### 10. Personal data & retention

| Data | Lawful basis | Retention |
|---|---|---|
| Co-host membership (user id ↔ event) | Contract (the co-host chose to accept) | Until they leave, are removed, delete their account, or the event is deleted (incl. 12-month event retention) |
| Co-host display name shown to guests | Contract; disclosed on the accept screen | Same as membership |
| `co_host_invites.accepted_by` | Legitimate interest (audit of who used a link) | 30 days after use; nulled on account deletion |
| Cover uploaded to an event folder | Contract (event content) | Until the event is deleted; owner deletion removes the folder; event deletion by retention leaves the object orphaned (pre-existing gap, see Risks) |

## Risks / Trade-offs

- [A co-host link forwarded to the wrong person is accepted] → single-use, 7-day expiry, owner sees co-hosts and can remove them instantly; accept screen names the event so mistakes are obvious.
- [Policy drift: a future policy uses `host_id = auth.uid()` and silently excludes co-hosts, or uses `is_event_manager` for a destructive action] → permission matrix lives here; pgTAP suite gets a reusable owner/co-host/stranger/former-co-host fixture and every policy test runs against all four.
- [Realtime keeps an already-open channel for a removed co-host] → RLS is checked per change, so no new rows are delivered; app also re-checks on reload.
- [Cover objects orphaned when events are deleted by retention or via the app] → pre-existing; this change does not make it worse. Follow-up: storage cleanup job keyed on `e/<event_id>`.
- [`is_event_co_host` called per row in `events` SELECT] → PK lookup on (`event_id`,`user_id`); event lists are small. Wrap `auth.uid()` in `select` as existing policies do.
- [Co-hosts' display names are now visible to anyone with the guest link] → disclosed on the accept screen; only names, never avatars or ids.

## Migration Plan

1. One migration adds helpers, tables, policies and function changes in a single transaction (`drop policy` + `create policy` for each changed policy). Existing events have no co-hosts, so behavior for current users is identical.
2. Deploy `delete-account` after the migration (it reads `events` by `host_id`, which exists already, so order is not critical).
3. Ship web (`/c/*` page + `.well-known`) before the mobile release that can create co-host links.
4. Rollback: a down migration restores the previous policies and drops the new tables/functions; co-host memberships are lost, owners are unaffected.

## Open Questions

- Exact English conjunction ("Anna & Erik" vs "Anna and Erik") — copy decision, does not affect implementation.
