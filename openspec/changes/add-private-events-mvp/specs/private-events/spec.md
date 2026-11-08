# Spec Delta

## Purpose

Lets a host create and manage a private event quickly, so that organising a party or meetup is faster than writing it in a group chat.

## ADDED Requirements

### Requirement: Create private event
The system SHALL let a signed-in host create an event with only a title, a start date and time, and a location. End time, description, and cover image or theme SHALL be optional.

#### Scenario: Minimal event created
- **WHEN** a host enters a title, start time and location and confirms
- **THEN** the event is created, owned by that host, and its invite link is shown ready to share

#### Scenario: Missing required field
- **WHEN** a host tries to create an event without a title, start time or location
- **THEN** the event is not created and the missing field is indicated

#### Scenario: Start time in the past
- **WHEN** a host sets a start time earlier than the current time
- **THEN** the event is not created and the host is asked to pick a future time

### Requirement: Event location
The system SHALL accept a location as free text (e.g. "Anna's place, Hornsgatan 12") and SHALL allow an optional map point. Times SHALL be stored with a time zone and shown in Europe/Stockholm time by default.

#### Scenario: Free-text location only
- **WHEN** a host enters a location without picking a map point
- **THEN** the event is created and guests see the free-text location without a map

#### Scenario: Location with map point
- **WHEN** a host picks a place from location search
- **THEN** guests see the place name and can open it in their maps app

### Requirement: Cover and theme
The system SHALL let a host pick a cover from built-in themes or upload an image. Events without a choice SHALL get a default theme.

#### Scenario: Uploaded cover
- **WHEN** a host uploads a cover image
- **THEN** the image is shown on the invite page and used in the link preview

#### Scenario: No cover chosen
- **WHEN** a host creates an event without choosing a cover
- **THEN** a default theme is applied

### Requirement: Events are private by default
An event SHALL only be visible to its host and to people who have its invite link. Events SHALL NOT appear in any search, listing or discovery surface.

#### Scenario: No link, no access
- **WHEN** someone without the invite link tries to find or access the event
- **THEN** no event details are returned

### Requirement: Edit event
The system SHALL let the host edit any event field until the event has ended. Guests SHALL see the latest details the next time they view the invite.

#### Scenario: Host changes time
- **WHEN** a host changes the start time of an upcoming event
- **THEN** the invite page shows the new time and marks that the time was updated

#### Scenario: Non-host cannot edit
- **WHEN** anyone other than the host attempts to change the event
- **THEN** the change is rejected

### Requirement: Cancel event
The system SHALL let the host cancel an event. A cancelled event's invite page SHALL show it as cancelled and SHALL NOT accept RSVPs.

#### Scenario: Guest opens cancelled event
- **WHEN** a guest opens the invite link of a cancelled event
- **THEN** the page shows the event title and that it was cancelled, with no RSVP options

### Requirement: Host event list
The system SHALL show a signed-in host their upcoming and past events, with the count of Going and Maybe responses for each.

#### Scenario: Host views events
- **WHEN** a host opens the app
- **THEN** they see upcoming events first, sorted by start time, each with Going and Maybe counts
