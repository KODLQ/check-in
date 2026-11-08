# Spec Delta

## Purpose

Lets people who host events sign in, present themselves with a minimal profile, and remove their account and data at any time.

## ADDED Requirements

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
The system SHALL let a signed-in host delete their account. Deleting an account SHALL delete their profile, their events, and all RSVPs to those events.

#### Scenario: Host deletes account
- **WHEN** a host confirms account deletion
- **THEN** their profile, events and those events' RSVPs are permanently removed and they are signed out

#### Scenario: Invite link after host deletion
- **WHEN** a guest opens an invite link to an event whose host deleted their account
- **THEN** the page shows that the event no longer exists and reveals no event details

### Requirement: Language
The system SHALL present its UI in Swedish or English, chosen from the device or browser language, defaulting to English for other languages.

#### Scenario: Swedish device
- **WHEN** a person opens the app or an invite page with Swedish as the preferred language
- **THEN** the UI is shown in Swedish
