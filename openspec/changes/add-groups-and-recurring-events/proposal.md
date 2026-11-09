# Proposal

## Why

The same friends meet again and again: a Friday After Work, a monthly dinner, a weekly padel game. Today a host has to create every date by hand and share a new link each time, and the app has no idea who "the usual people" are. Recurring plans are the most frequent kind of private event. If they are effortless, hosts and guests open the app every week. That is the habit the growth wedge needs.

## What Changes

- **Groups**: a host creates a named group (for example "AW crew") and fills it two ways:
  - **Group invite link**: people with an app account open the link and join.
  - **Past guests**: the host picks people who answered their earlier events with an account. Each person gets an invitation to accept first; nobody becomes a member without saying yes.
  - **Members**: they see the group's name, its owner, admins and the other members, and can leave at any time.
  - **Admins**: the owner and admins can make members admins. Admins can rename the group, share or revoke the link, invite past guests, remove regular members, and invite the group to their own events. Only the owner can demote or remove an admin, or delete the group.
  - **Owner leaving**: the owner must hand the group, including its series, over to another member before leaving. The app suggests the longest-standing admin, or the longest-standing member if there is no admin. If the owner deletes their account, the group and its series pass automatically by the same rule.
- **Inviting a group to a one-off event**: when creating or editing an event, a host who owns or administers a group can invite it.
  - Every member gets the event in their app list as "Not answered yet", plus a push notification, and can answer in the app.
  - The normal invite link keeps working for everyone else.
- **Recurring events (series)**: a series belongs to a group, not a person. The group's owner or an admin makes an event repeat every week, every 2 weeks or monthly (for example "first Friday"), with an optional end date. Someone without a group creates one in the same flow.
  - Each date is a normal event with its own RSVPs, capacity, waitlist, wall and invite link.
  - The next four upcoming dates always exist, and a new one is created automatically when a date ends.
  - Every date invites the group's members automatically. Each date also has its own invite link, so anyone else, with or without an account, can be a guest at that date. Guests see the date as hosted by the group, with the owner's name.
  - The group's owner and admins manage the series and its dates. When the group changes owner, the series moves with it.
- **Editing a series**:
  - Edit **this date only** (today's edit) or **this and all following dates**: title, details, location, time of day, capacity, cover and theme.
  - Changing the repeat rule affects dates created from then on.
  - Ending the series stops new dates. Whoever ends it chooses whether already-created upcoming dates are kept or cancelled. Deleting the group ends its series and cancels upcoming dates.
  - Each date can still have its own co-hosts, who can edit only that date.
- **Notifications**: five new kinds:
  - group invitation
  - "new date open" for group members, sent when a date is created for a series or event that invites the group
  - a reminder about 24 hours before a group event, for members who still haven't answered
  - group join, sent to the owner
  - new owner, sent to whoever takes over a group

## Capabilities

### New Capabilities
- `groups`: named groups of app users owned by a host, with admins. Covers membership by link or by accepted invitation, admin rights, member list visibility, leaving and removal, limits.
- `recurring-events`: group-owned event series with a repeat rule, automatic creation of dates, management by the group's owner and admins, editing one date versus following dates, ending a series, and the series moving with group ownership.

### Modified Capabilities
- `private-events`: a one-off event can invite a group its owner owns or administers; the invite stops when those rights end. The event list groups dates of a series and shows the group and repeat rule.
- `my-invites`: events that invite a group the user belongs to appear as "Not answered yet" and can be answered in the app, even without an earlier RSVP. Dates of one series are grouped into one item.
- `notifications`: new kinds (group invitation, group join, new date open, not-answered reminder); recipients for group-wide notifications are the members at send time.
- `co-hosts`: for dates of a group's series, the group's admins get the owner-only rights (except deleting a date).
- `user-accounts`: deleting an account hands its groups and their series over to another member (or deletes them if nobody is left), and removes its memberships.

## Out of scope

- A friend list or follow graph, and anything about check-ins or public events. Groups are the base for that later.
- Group chat, group walls or group photos. Walls stay per date.
- Group membership without an app account. People without an account can still be guests at any group event or series date through its invite link, answering on the web as today; they just aren't group members.
- Rotating hosts per date, repeat rules other than weekly, every 2 weeks and monthly by weekday, and exceptions such as "skip 24 Dec" other than cancelling that date.
- Date polls on a series, and calendar export (`.ics`).
- Attendance statistics or "who usually comes" suggestions.

## Impact

- **Database (Supabase)**:
  - New tables: `groups`, `group_members`, `group_invitations`, `group_invite_links`, `event_series`.
  - New columns: `events.series_id`, `events.group_id`, `events.occurrence_index`.
  - New RPCs and a pg_cron job that creates dates.
  - Changed functions: `is_event_manager` (group admins on series dates), `list_my_invites`, `get_my_invite`, `set_my_rsvp`, `events_guard`, `get_invite` (group as host), `run_retention` and account deletion.
  - New pgTAP tests.
- **Notifications**: five new notification kinds, with sv/en templates in `packages/shared`.
- **Mobile app (`apps/mobile`)**:
  - New screens: groups list, group detail and the join screen at `/g/[token]`.
  - New controls: a repeat picker with a group picker (and inline group creation) in the event form.
  - Changed screens: the "This date / All following" choice when editing, series labels in the home list, and "Not answered yet" invites.
- **Web (`apps/web`)**: a `/g/[token]` page that shows the group name and owner and hands off to the app. No membership without an account.
- **Personal data**: group names, memberships and invitations are stored. Memberships go when the member leaves or deletes their account. Groups pass to another member when the owner leaves or deletes their account.
