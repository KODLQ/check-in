# user-accounts Specification

## Purpose

Lets people who host events sign in, present themselves with a minimal profile, and remove their account and data at any time.

## Requirements

### Requirement: Host sign-in
The system SHALL let a person sign in with an email magic link, Sign in with Apple, or Google. No password SHALL be required.

#### Scenario: Sign in with magic link
- **WHEN** a person enters their email and opens the magic link sent to it
- **THEN** they are signed in and taken to their events

#### Scenario: Sign in with Apple on iOS
- **WHEN** a person chooses Sign in with Apple on iOS and completes the Apple prompt
- **THEN** they are signed in without entering an email manually

#### Scenario: Expired magic link
- **WHEN** a person opens a magic link that has expired or was already used
- **THEN** they are told the link is no longer valid and offered to send a new one

### Requirement: Minimal profile
The system SHALL require a display name on first sign-in and allow an optional avatar image. The display name SHALL be shown to guests as the event host.

#### Scenario: First sign-in asks for a name
- **WHEN** a person signs in for the first time
- **THEN** they are asked for a display name before creating an event

#### Scenario: Host name shown on invite
- **WHEN** a guest opens an invite for an event
- **THEN** the host's display name and avatar (if set) are shown

### Requirement: Account deletion
The system SHALL let a signed-in host delete their account. Deleting an account SHALL delete their profile, the events they own, and all RSVPs to those events, for everyone including those events' co-hosts. It SHALL also delete every RSVP the account made or claimed on other people's events. For events the person only co-hosts, it SHALL remove only their co-host membership; those events and their RSVPs SHALL remain.

#### Scenario: Host deletes account
- **WHEN** a host confirms account deletion
- **THEN** their profile, events and those events' RSVPs are permanently removed and they are signed out

#### Scenario: Invite link after host deletion
- **WHEN** a guest opens an invite link to an event whose host deleted their account
- **THEN** the page shows that the event no longer exists and reveals no event details

#### Scenario: Claimed responses removed with account
- **WHEN** a user who claimed web responses deletes their account
- **THEN** those responses are removed from the hosts' guest lists

#### Scenario: Co-host deletes account
- **WHEN** a person who co-hosts Anna's event deletes their account
- **THEN** they are no longer a co-host, Anna's event, its RSVPs and its cover stay intact, and guests no longer see their name as a host

#### Scenario: Owner with co-hosts deletes account
- **WHEN** the owner of an event that has co-hosts deletes their account
- **THEN** the event and its RSVPs are deleted and the event disappears from the co-hosts' event lists

### Requirement: Language
The system SHALL present its UI in Swedish or English, chosen from the device or browser language, defaulting to English for other languages.

#### Scenario: Swedish device
- **WHEN** a person opens the app or an invite page with Swedish as the preferred language
- **THEN** the UI is shown in Swedish

### Requirement: Wall content removed with account
Deleting an account SHALL also delete every event wall post and photo the account made, on any event, including posts made from a browser whose responses were claimed into the account. Wall posts and photos on events the account owns SHALL be deleted with those events. Posts the person made as a co-host on events they did not own SHALL be deleted too.

#### Scenario: Wall posts on other events
- **WHEN** a person who posted on another host's event wall from the app deletes their account
- **THEN** those posts and their photos are removed from that wall

#### Scenario: Claimed web posts
- **WHEN** a guest posted on a wall from the browser, later claimed that browser's responses into their account, and then deletes the account
- **THEN** the posts made from the browser are removed too

#### Scenario: Host deletes account
- **WHEN** a host with wall posts on their events deletes their account
- **THEN** every post and photo on those events' walls is removed together with the events
