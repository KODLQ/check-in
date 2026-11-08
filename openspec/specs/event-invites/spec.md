# event-invites Specification

## Purpose

Turns every private event into a shareable link that looks good in any chat app and opens instantly in a browser, so invites spread where young people already talk.

## Requirements

### Requirement: Unguessable invite link
Each event SHALL have an invite link containing a random token that cannot practically be guessed or enumerated. The link SHALL be short enough to paste comfortably in a chat.

#### Scenario: Link created with event
- **WHEN** an event is created
- **THEN** it has an invite link with a random token of at least 64 bits of entropy

#### Scenario: Wrong token
- **WHEN** someone opens an invite URL with a token that does not match any active link
- **THEN** a generic "invite not found" page is shown, identical for missing and revoked links

### Requirement: Web invite page
Opening an invite link SHALL show the event in any modern mobile or desktop browser without installing the app or signing in. The page SHALL show title, cover, host name, date and time, location, and description.

#### Scenario: Guest opens link in a chat app's browser
- **WHEN** a guest taps the invite link inside iMessage, WhatsApp, Snapchat or Instagram
- **THEN** the invite page loads with the event details and RSVP options, with no sign-in or install prompt blocking it

#### Scenario: Add to calendar
- **WHEN** a guest chooses "Add to calendar" on the invite page
- **THEN** they get a calendar entry with the event's title, time and location

### Requirement: Rich link previews
Invite links SHALL provide link-preview metadata (title, date and time, host name, and a preview image) so chat apps show a rich card. Previews SHALL NOT include the guest list or the exact address.

#### Scenario: Link pasted in a chat
- **WHEN** an invite link is pasted into a chat app that renders link previews
- **THEN** the preview shows the event title, date and time, and the cover image

#### Scenario: Preview hides address
- **WHEN** a link preview is generated
- **THEN** it does not include the free-text location or the guest list

### Requirement: Share from the app
The app SHALL let the host share the invite link through the device share sheet and copy it to the clipboard.

#### Scenario: Share via share sheet
- **WHEN** a host taps Share on their event
- **THEN** the native share sheet opens with the invite link and a short invite message

### Requirement: Revoke and regenerate link
The host SHALL be able to revoke the invite link and get a new one. Revoked links SHALL stop working immediately. Guests who already responded SHALL keep their RSVP.

#### Scenario: Link leaked
- **WHEN** a host regenerates the invite link
- **THEN** the old link shows "invite not found", the new link works, and existing RSVPs are kept

### Requirement: Open in app when installed
When the app is installed, opening an invite link on that device SHALL be able to open the event in the app; otherwise the web page SHALL be shown.

#### Scenario: App installed
- **WHEN** a person with the app installed opens an invite link on their phone
- **THEN** the event opens in the app

### Requirement: Plan-your-own prompt after RSVP
After a guest has responded on the invite page, the page SHALL show a non-blocking "Plan your own in 30 seconds →" prompt in the page language (Swedish or English). Before a response, the page SHALL NOT show it in a way that competes with the RSVP options.

#### Scenario: Prompt after responding
- **WHEN** a guest taps Going on the invite page
- **THEN** their answer is shown and, below it, a "Plan your own in 30 seconds →" prompt appears without covering the event details or RSVP options

#### Scenario: Prompt in Swedish
- **WHEN** a guest with Swedish as the preferred language has responded
- **THEN** the prompt is shown in Swedish

#### Scenario: Ignoring the prompt
- **WHEN** a guest ignores the prompt
- **THEN** they can still change or withdraw their response and use every other part of the page

### Requirement: Hand-off from invite page to the app
Following the prompt SHALL lead to a page that links to the app stores and offers to open the app with a claim code for that browser's responses. The browser's guest token and the claim code SHALL NOT appear in any URL path, query string or Referer header sent to a server.

#### Scenario: App not installed
- **WHEN** a guest follows the prompt on a phone without the app
- **THEN** they see links to the App Store and Google Play, and an "Open the app" button that works once the app is installed

#### Scenario: App installed
- **WHEN** a guest with the app installed taps "Open the app" on the hand-off page
- **THEN** the app opens, asks them to sign in if needed, and then adds their web responses to their invites

#### Scenario: Secret stays out of server logs
- **WHEN** the hand-off page is loaded or any link on it is followed
- **THEN** no request to the web or API servers carries the claim code or guest token in its URL or Referer
