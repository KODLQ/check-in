# Spec Delta

## MODIFIED Requirements

### Requirement: Post announcement
The host and co-hosts SHALL be able to post a text announcement of 1 to 500 characters on an event that has not ended and is not cancelled. Nobody else SHALL be able to post on it.

#### Scenario: Host posts
- **WHEN** the host writes "Doors open 19:30, ring Andersson" and posts it
- **THEN** the announcement is saved with the time it was posted and shown on the event

#### Scenario: Co-host posts
- **WHEN** a co-host posts an announcement on an event they co-host
- **THEN** it is saved and shown on the event exactly as if the owner had posted it

#### Scenario: Too long or empty
- **WHEN** the host tries to post an empty announcement or one longer than 500 characters
- **THEN** it is not posted and the limit is shown

#### Scenario: Not the host
- **WHEN** a guest, a former co-host or another signed-in user tries to post an announcement on the event
- **THEN** it is rejected

#### Scenario: Ended or cancelled event
- **WHEN** the host tries to post on an event that has ended or been cancelled
- **THEN** it is rejected

### Requirement: Delete announcement
The host and co-hosts SHALL be able to delete any announcement on the event. A deleted announcement SHALL disappear from the invite page and the app, and SHALL NOT be delivered to anyone who has not yet received it.

#### Scenario: Deleted before delivery
- **WHEN** the host deletes an announcement that is waiting for quiet hours to end
- **THEN** it is removed everywhere and no guest is notified about it

#### Scenario: Deleted after delivery
- **WHEN** the host deletes an announcement that guests already received
- **THEN** it disappears from the invite page and the app, and already-sent notifications are not recalled

#### Scenario: Co-host deletes the owner's announcement
- **WHEN** a co-host deletes an announcement the owner posted
- **THEN** it disappears from the invite page and the app for everyone
