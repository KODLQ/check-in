# Proposal

## Why

"When works for everyone?" is the most common reason a group-chat plan dies: the host asks, ten replies scroll by, nobody counts them, and the event never gets created. Today check-in forces the host to commit to one start time before an invite can even exist, so that negotiation still happens in the chat. Letting the host send the invite *first* and settle the date inside it keeps the whole plan in one link and gives us another reason for guests to open it.

## What Changes

- New **date poll** mode when creating an event: instead of one start time, the host proposes 2–4 candidate start times (each with an optional end time) and an optional voting deadline. The event is created "date pending" and its invite link works immediately.
- Guests vote **Yes / If needed / No** per option on the invite page, with the same no-account identity as RSVPs (display name + device guest token; signed-in app users vote as themselves). Votes can be changed or withdrawn until the poll closes. Same abuse limits as RSVPs.
- Tallies per option are visible to guests; voter names follow the event's existing guest-list visibility setting (Yes / If needed names only, never No).
- The host sees live results and **picks the winning option** at any time. Picking sets the event's start/end, closes the poll, converts Yes voters to Going and If-needed voters to Maybe RSVPs (No voters get no RSVP), deletes the individual votes, and from then on the event behaves exactly like a normal event.
- The host can add, change or remove options while the poll is open; removing or re-timing an option deletes its votes after an explicit warning.
- Guards: candidate times in the past are rejected; options whose time passes stop accepting votes and cannot be picked; a pending event can be cancelled like any other.
- While the date is pending: RSVP is disabled, "Add to calendar" is hidden, link previews read "Date TBD — vote now", and the host's event list shows the event as "Date TBD".
- When the `notifications` capability (from `add-guest-updates`) is available, voters are notified when a date is picked. Everything in this change works without it: the invite page always shows the current state.
- **Not breaking**: existing fixed-date events and their flows are unchanged; a fixed-date event cannot be turned back into a poll.

### Out of scope

- Recurring events or picking multiple dates.
- Importing calendar availability (Google/Apple/Outlook free/busy).
- Ranked-choice, weighted or anonymous voting; comments on options.
- Polling on anything other than the start time (e.g. location polls).
- Automatically picking a winner at the deadline (the deadline only stops voting).
- Converting an already-dated event into a poll.

## Capabilities

### New Capabilities
- `date-polls`: Candidate start times for a date-pending event, guest voting on them, tallies and voter visibility, poll closing, and the host picking the winning option (including conversion of votes into RSVPs).

### Modified Capabilities
- `private-events`: "Create private event" no longer always requires a start time (a date poll can replace it); "Host event list" shows date-pending events.
- `event-invites`: "Web invite page" shows the candidate options instead of a date while pending and hides Add to calendar; "Rich link previews" show "Date TBD — vote now" instead of a date and time.
- `event-rsvp`: "RSVP closed for inactive events" also closes RSVP while the date is pending.

## Impact

- **Database** (`supabase/migrations`): `events.starts_at` becomes nullable (null = date pending) plus poll columns; new tables for poll options, voters and votes with RLS; new security-definer RPCs (create poll event, edit options, submit/withdraw votes for guests and signed-in users, pick option); `events_guard`, `get_invite`, `open_event_for_token` and `run_retention` updated to understand pending events. New pgTAP tests.
- **Shared** (`packages/shared`): zod schemas for poll input and ballots, vote-choice constants, regenerated `database.types.ts`, sv/en strings.
- **Web** (`apps/web`): invite page poll UI, new `/api/votes` route with the existing per-IP rate limiting, `generateMetadata` + `opengraph-image.tsx` "Date TBD" variant, `calendar.ics` unavailable while pending.
- **Mobile** (`apps/mobile`): event form gains a "Let guests vote" mode, event detail shows live poll results with Pick and Edit options, host event list "Date TBD" rows, in-app invite screen voting for signed-in users.
- **Related changes**: `add-guest-updates` (owns `notifications`; this change emits a "date picked" update through it if present). `add-co-hosts` / `add-guest-capacity` touch the same specs; whichever archives later must rebase its MODIFIED blocks.
