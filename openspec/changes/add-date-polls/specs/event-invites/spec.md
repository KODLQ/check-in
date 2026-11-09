# Spec Delta

## MODIFIED Requirements

### Requirement: Web invite page
Opening an invite link SHALL show the event in any modern mobile or desktop browser without installing the app or signing in. The page SHALL show title, cover, host names (the owner first, then any co-hosts), date and time, location, and description. While the event's date is pending, the page SHALL show the candidate options with voting in place of the date and time, and SHALL NOT offer Add to calendar.

#### Scenario: Guest opens link in a chat app's browser
- **WHEN** a guest taps the invite link inside iMessage, WhatsApp, Snapchat or Instagram
- **THEN** the invite page loads with the event details and RSVP options, with no sign-in or install prompt blocking it

#### Scenario: Add to calendar
- **WHEN** a guest chooses "Add to calendar" on the invite page
- **THEN** they get a calendar entry with the event's title, time and location

#### Scenario: Event with co-hosts
- **WHEN** a guest opens the invite of an event owned by Anna and co-hosted by Erik
- **THEN** the page shows "Hosted by Anna & Erik"

#### Scenario: Guest opens a date-pending invite
- **WHEN** a guest opens the invite link of an event whose date is pending
- **THEN** the page shows title, cover, host names, location, description and the candidate times with vote options, and no RSVP or Add to calendar options

#### Scenario: Calendar file requested while pending
- **WHEN** someone requests the calendar file of a date-pending event
- **THEN** no calendar entry is returned until a date is picked

### Requirement: Rich link previews
Invite links SHALL provide link-preview metadata (title, date and time, host name, and a preview image) so chat apps show a rich card. While the date is pending, the preview SHALL show "Date TBD — vote now" in place of the date and time. Previews SHALL NOT include the guest list, the exact address, or poll tallies or voter names.

#### Scenario: Link pasted in a chat
- **WHEN** an invite link is pasted into a chat app that renders link previews
- **THEN** the preview shows the event title, date and time, and the cover image

#### Scenario: Preview hides address
- **WHEN** a link preview is generated
- **THEN** it does not include the free-text location or the guest list

#### Scenario: Preview of a date-pending event
- **WHEN** the invite link of a date-pending event is pasted into a chat app
- **THEN** the preview shows the title, "Date TBD — vote now", the host name and the cover image, without tallies or voter names

## ADDED Requirements

### Requirement: Story image for a date-pending event
While an event's date is pending, its story image SHALL be available under the same rules as for a dated event and SHALL show "Date TBD — vote now" in place of the start date and time. It SHALL NOT show the candidate times, tallies or voter names.

#### Scenario: Host shares a poll to their story
- **WHEN** the story image is requested for an active invite whose event's date is pending
- **THEN** a 1080×1920 PNG is returned showing the cover or theme, title, "Date TBD — vote now", host name, call to action and invite URL
