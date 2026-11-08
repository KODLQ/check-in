# Proposal

## Why

Hosts can't currently say "bring a friend" or "only 20 people fit in my flat". Guests write "+1?" in the group chat instead, the Going count lies about how many people show up, and small venues get overbooked. Plus-ones, a capacity limit and an automatic waitlist make the guest list match the room, which is the next most-requested thing after the MVP invite/RSVP flow.

## What Changes

- Hosts can allow plus-ones per event (off by default) with a maximum per guest (1–5), and set an optional capacity (max attendees, counting guests plus their plus-ones). Both are set on create and edit and never add a required field, so creating an event still takes under 30 seconds.
- Guests answering Going choose how many plus-ones they bring (0..max) when the host allows it. Maybe and Can't go carry no plus-ones.
- Every attendee count (invite page, host guest list, host event list) counts heads, guests plus their plus-ones. The host guest list shows "+N" next to a guest.
- When a Going answer would exceed capacity, the guest joins a waitlist instead and sees their position. A full event's invite page says "Full — join waitlist".
- When spots free up (a guest switches answer, lowers plus-ones, withdraws, is removed, or the host raises capacity), the earliest waitlisted guests who fit are promoted to Going automatically and atomically, with no overbooking under concurrent requests.
- Lowering capacity below the current Going count removes nobody. It only sends new Going answers to the waitlist until the count is under capacity.
- Hosts can manually promote or remove waitlisted guests.
- Promoted guests see "You got a spot" on the invite page. When the `notifications` capability (change `add-guest-updates`) is available, a promotion also sends them a message; correctness never depends on it.
- **BREAKING (internal API):** host and self removal of RSVPs moves from a direct table `DELETE` to a security-definer RPC so every write that frees a spot runs the promotion. The `rsvps` delete RLS policy is dropped. No user-facing behavior is lost.

### Out of scope

- Paid or ticketed events, deposits, ticket tiers.
- Per-guest custom plus-one limits or named plus-ones (plus-ones are a number only).
- Check-in or scanning at the door, attendance tracking.
- Waitlist for Maybe answers, waitlist expiry or "accept your spot within X hours" flows.
- Showing capacity or "full" in link previews (previews stay as defined in `event-invites`).

## Capabilities

### New Capabilities
- `event-capacity`: Attendee capacity limit per event, the waitlist (joining, position, leaving), automatic promotion when spots free up, and host management of waitlisted guests.

### Modified Capabilities
- `event-rsvp`: "RSVP without account" gains plus-ones on Going; "Change or withdraw RSVP" covers changing plus-ones and freeing spots; "Host guest list" counts heads, shows "+N" and a Waitlist group; "Guest list visibility" counts heads and hides waitlisted names; "Remove guest" frees spots.
- `private-events`: "Create private event" and "Edit event" gain optional plus-one and capacity settings; "Host event list" counts heads.

## Impact

- **Database:** new migrations adding `events.allow_plus_ones`, `events.max_plus_ones`, `events.capacity`; `rsvps.plus_ones`, `rsvps.waitlisted_at`, `rsvps.promoted_at`; enum value `waitlisted` on `rsvp_status`. Rewritten `upsert_rsvp`, `rsvp_as_user`, `withdraw_rsvp`, `get_invite`; new `remove_rsvp`, `promote_waitlisted`, internal `promote_from_waitlist`; trigger on `events` for capacity/plus-one changes. New pgTAP tests and a concurrency test.
- **Shared package:** schemas (`makeEventInputSchema`, `rsvpInputSchema`), regenerated `database.types.ts`, head-count helper, sv/en strings.
- **Web (`apps/web`):** invite page counts/full state, plus-one picker and waitlist position in `rsvp-form.tsx`, `/api/rsvp` accepts `plusOnes` and maps new errors.
- **Mobile (`apps/mobile`):** event form settings, guest list "+N" and Waitlist group with promote/remove, host event list head counts, in-app RSVP (`i/[token].tsx`) plus-ones.
- **Siblings:** emits a promotion hook consumed by `notifications` from `add-guest-updates`; no hard dependency.
