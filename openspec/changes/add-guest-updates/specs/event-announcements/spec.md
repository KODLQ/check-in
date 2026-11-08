# Spec Delta

## Purpose

Lets the host post short updates on an event ("Bring a jacket, we're on the roof") that every guest sees on the invite and that reach the people who are coming, without the host needing a group chat.

## ADDED Requirements

### Requirement: Post announcement
The host SHALL be able to post a text announcement of 1 to 500 characters on an event that has not ended and is not cancelled. Nobody else SHALL be able to post on it.

#### Scenario: Host posts
- **WHEN** the host writes "Doors open 19:30, ring Andersson" and posts it
- **THEN** the announcement is saved with the time it was posted and shown on the event

#### Scenario: Too long or empty
- **WHEN** the host tries to post an empty announcement or one longer than 500 characters
- **THEN** it is not posted and the limit is shown

#### Scenario: Not the host
- **WHEN** a guest or another signed-in user tries to post an announcement on the event
- **THEN** it is rejected

#### Scenario: Ended or cancelled event
- **WHEN** the host tries to post on an event that has ended or been cancelled
- **THEN** it is rejected

### Requirement: Announcement limit
The system SHALL allow at most 5 announcements per event in any 24-hour period, counting announcements that were deleted.

#### Scenario: Sixth announcement in a day
- **WHEN** the host has posted 5 announcements in the last 24 hours and tries to post another
- **THEN** it is rejected and the host is told when they can post again

### Requirement: Show announcements
The invite page and the event screens in the app SHALL list the event's announcements newest first, with the time posted. Anyone who can view the invite SHALL see them; cancelled and not-found invites SHALL show none.

#### Scenario: Guest opens invite
- **WHEN** a guest opens an invite with two announcements
- **THEN** both are shown, newest first, each with its relative posting time

#### Scenario: Invite not found
- **WHEN** someone opens a revoked or unknown invite link
- **THEN** no announcements are shown or returned

### Requirement: Announcement delivery
A new announcement SHALL be delivered as a notification to guests who are Going or Maybe when it is sent, through the notification channels each guest has. Can't go guests and the author SHALL NOT be notified.

#### Scenario: Mixed guest list
- **WHEN** the host posts an announcement to an event with Going, Maybe and Can't go guests
- **THEN** Going and Maybe guests with push or email updates are notified and Can't go guests are not

#### Scenario: Announcement text in notification
- **WHEN** a guest receives an announcement notification
- **THEN** it shows the event title and the announcement text, in full in email and shortened in push

### Requirement: Delete announcement
The host SHALL be able to delete an announcement. A deleted announcement SHALL disappear from the invite page and the app, and SHALL NOT be delivered to anyone who has not yet received it.

#### Scenario: Deleted before delivery
- **WHEN** the host deletes an announcement that is waiting for quiet hours to end
- **THEN** it is removed everywhere and no guest is notified about it

#### Scenario: Deleted after delivery
- **WHEN** the host deletes an announcement that guests already received
- **THEN** it disappears from the invite page and the app, and already-sent notifications are not recalled
