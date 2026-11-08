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

### Requirement: Rich link previews
Invite links SHALL provide link-preview metadata (title, date and time, host name, and a preview image) so chat apps show a rich card. Previews SHALL NOT include the guest list or the exact address.

#### Scenario: Link pasted in a chat
- **WHEN** an invite link is pasted into a chat app that renders link previews
- **THEN** the preview shows the event title, date and time, and the cover image

#### Scenario: Preview hides address
- **WHEN** a link preview is generated
- **THEN** it does not include the free-text location or the guest list

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

### Requirement: Story share image
Each active invite SHALL have a portrait story image of 1080×1920 pixels. The image SHALL show the event cover (or its theme when there is no cover), title, start date and time, host display name, a short call to action, and the invite URL as readable text.

#### Scenario: Event with uploaded cover
- **WHEN** the story image is requested for an active invite whose event has an uploaded cover
- **THEN** a 1080×1920 PNG is returned showing the cover, title, start date and time, host name, call to action and invite URL

#### Scenario: Event without cover
- **WHEN** the story image is requested for an active invite whose event has no uploaded cover
- **THEN** the image uses the event's theme as background with the same text content

#### Scenario: Long title
- **WHEN** the event title is too long to fit the layout
- **THEN** the title is shortened with an ellipsis and the date, host name and invite URL remain fully visible

### Requirement: Story image privacy
The story image SHALL NOT include the event location (free text, place name or map point), the description, the guest list, or response counts.

#### Scenario: Event with address and visible guest list
- **WHEN** the story image is generated for an event that has a location, a description and a visible guest list
- **THEN** none of the location, description, guest names or counts appear in the image

### Requirement: Story image availability
The story image SHALL be available only while the invite is active and the event is neither cancelled nor ended. Otherwise the request SHALL return the same "not found" response, without an image, whether the token is unknown, revoked, belongs to a deleted event, or the event is cancelled or ended.

#### Scenario: Revoked link
- **WHEN** a host regenerates the invite link and someone requests the story image for the old token
- **THEN** a "not found" response without an image is returned

#### Scenario: Cancelled event
- **WHEN** the story image is requested for an event that has been cancelled
- **THEN** the same "not found" response without an image is returned

#### Scenario: Ended event
- **WHEN** the story image is requested after the event has ended
- **THEN** the same "not found" response without an image is returned

### Requirement: Story image freshness
After the host edits an event, the story image SHALL reflect the new details on any request made one minute or more after the edit. A revoked or cancelled invite SHALL stop serving its image within one minute.

#### Scenario: Host changes title
- **WHEN** a host changes the event title and the story image is requested a minute later
- **THEN** the image shows the new title

#### Scenario: Host cancels after image was shared
- **WHEN** a host cancels an event whose story image was already fetched, and the image URL is requested again a minute later
- **THEN** the "not found" response is returned

### Requirement: Story image language
The story image's call to action and date format SHALL be in Swedish or English, following the requester's language, defaulting to English. The host app SHALL request the image in the host's app language.

#### Scenario: Swedish host shares
- **WHEN** a host whose app is in Swedish shares to their story
- **THEN** the story image shows the call to action and date in Swedish

### Requirement: Share to Instagram Stories from the app
When Instagram is installed and Instagram sharing is configured, the host app SHALL offer "Share to Story" on an active event, which opens Instagram's story composer with the story image and puts the invite link on the clipboard so the host can paste it into a link sticker.

#### Scenario: Host shares to Instagram
- **WHEN** a host with Instagram installed taps Share to Story and picks Instagram on an active event
- **THEN** Instagram opens its story composer with the story image, and the invite link is on the clipboard with a hint to add it as a link sticker

#### Scenario: Instagram not installed
- **WHEN** a host without Instagram installed taps Share to Story
- **THEN** Instagram is not offered as a destination

### Requirement: Share to Snapchat from the app
When Snapchat is installed and Snapchat sharing is configured, the host app SHALL offer Snapchat as a Share to Story destination, which opens Snapchat with the story image and the invite link attached so viewers can open it from the snap.

#### Scenario: Host shares to Snapchat
- **WHEN** a host with Snapchat installed picks Snapchat from Share to Story on an active event
- **THEN** Snapchat opens a preview containing the story image with the invite link attached

#### Scenario: Snapchat sharing not configured
- **WHEN** Snapchat is installed but Snapchat sharing is not configured in the app build
- **THEN** Snapchat is not offered as a direct destination and the share-sheet option is still available

### Requirement: Story share fallback in the app
Share to Story SHALL always offer the native share sheet with the story image and the invite link, so the host can share even when no direct integration is available or a direct integration fails.

#### Scenario: No supported apps installed
- **WHEN** a host taps Share to Story and neither Instagram nor Snapchat is available as a direct destination
- **THEN** the native share sheet opens with the story image and the invite link

#### Scenario: Direct share fails
- **WHEN** opening Instagram or Snapchat fails after the host picked it
- **THEN** the host is shown an error and the native share sheet opens with the story image and the invite link

#### Scenario: Image cannot be fetched
- **WHEN** the story image cannot be downloaded, for example because the device is offline
- **THEN** the host is told the image could not be prepared and no partial share is started

### Requirement: Guest shares invite from the web page
The web invite page SHALL let any viewer of an active invite share it. Where the browser can share files, it SHALL open the share sheet with the story image and the invite link. Otherwise it SHALL offer to save the story image and to copy the invite link. No sign-in, RSVP or app install SHALL be required.

#### Scenario: Browser supports file sharing
- **WHEN** a guest on a phone browser that supports sharing files taps Share on an active invite
- **THEN** the system share sheet opens with the story image and the invite link

#### Scenario: Browser without file sharing
- **WHEN** a guest taps Share in a browser that cannot share files, such as an in-app browser
- **THEN** they are offered "Save image" and "Copy link", and copying puts the invite link on the clipboard

#### Scenario: Inactive invite
- **WHEN** a guest opens the invite page of a cancelled or ended event
- **THEN** no Share action is shown
