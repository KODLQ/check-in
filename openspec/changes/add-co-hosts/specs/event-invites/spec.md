# Spec Delta

## MODIFIED Requirements

### Requirement: Web invite page
Opening an invite link SHALL show the event in any modern mobile or desktop browser without installing the app or signing in. The page SHALL show title, cover, host names (the owner first, then any co-hosts), date and time, location, and description.

#### Scenario: Guest opens link in a chat app's browser
- **WHEN** a guest taps the invite link inside iMessage, WhatsApp, Snapchat or Instagram
- **THEN** the invite page loads with the event details and RSVP options, with no sign-in or install prompt blocking it

#### Scenario: Add to calendar
- **WHEN** a guest chooses "Add to calendar" on the invite page
- **THEN** they get a calendar entry with the event's title, time and location

#### Scenario: Event with co-hosts
- **WHEN** a guest opens the invite of an event owned by Anna and co-hosted by Erik
- **THEN** the page shows "Hosted by Anna & Erik"

### Requirement: Share from the app
The app SHALL let the host and co-hosts share the invite link through the device share sheet and copy it to the clipboard.

#### Scenario: Share via share sheet
- **WHEN** a host taps Share on their event
- **THEN** the native share sheet opens with the invite link and a short invite message

#### Scenario: Co-host shares
- **WHEN** a co-host taps Share on an event they co-host
- **THEN** the native share sheet opens with the same active invite link

### Requirement: Revoke and regenerate link
The host and co-hosts SHALL be able to revoke the invite link and get a new one. Revoked links SHALL stop working immediately. Guests who already responded SHALL keep their RSVP.

#### Scenario: Link leaked
- **WHEN** a host regenerates the invite link
- **THEN** the old link shows "invite not found", the new link works, and existing RSVPs are kept

#### Scenario: Co-host regenerates
- **WHEN** a co-host regenerates the invite link
- **THEN** the old link shows "invite not found" and the owner and other co-hosts see the new link
