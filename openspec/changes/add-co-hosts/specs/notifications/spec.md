# Spec Delta

## MODIFIED Requirements

### Requirement: Notification opens the event
Tapping a push SHALL open the related event in the app, and every email SHALL link to the event's current invite page.

#### Scenario: Tap push
- **WHEN** a user taps a notification about an event
- **THEN** the app opens that event's screen (host view for the host and co-hosts, invite view for a guest)

#### Scenario: Link regenerated after send
- **WHEN** the host regenerates the invite link and a later email is sent
- **THEN** the email links to the new, working invite link

### Requirement: Host reply digest
The host and each co-host SHALL get a push when guests reply or change their response, batched to at most one push per event per 15 minutes that summarises the new replies. Withdrawals and RSVPs by the host or a co-host SHALL NOT trigger it.

#### Scenario: Burst of replies
- **WHEN** six guests reply within ten minutes of an invite being shared
- **THEN** the host gets one push for the first reply and one later push summarising the other five

#### Scenario: Digest during quiet hours
- **WHEN** guests reply at 01:00
- **THEN** the host gets a single summary push at 08:00

#### Scenario: Co-host gets the digest
- **WHEN** a guest replies to an event that has a co-host with notifications allowed
- **THEN** the owner and the co-host each get the digest push, and a former co-host does not
