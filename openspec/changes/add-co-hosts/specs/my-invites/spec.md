# Spec Delta

## MODIFIED Requirements

### Requirement: Invites listed with hosted events
The app SHALL show a signed-in user every event they hold an RSVP for through their account (Going, Maybe or Can't go), together with the events they host or co-host. Each item SHALL be labelled as hosted by the user, co-hosted by the user, or an invite. An event the user hosts or co-hosts SHALL appear only once, as hosted or co-hosted.

#### Scenario: Guest with an account opens the app
- **WHEN** a signed-in user who answered Going to someone else's event opens the app
- **THEN** that event is listed, labelled as an invite with the host's display name

#### Scenario: Hosted and invited events together
- **WHEN** a signed-in user both hosts events and has answered invites
- **THEN** both appear in the same list, each labelled as hosted or invite

#### Scenario: Invite opened but never answered
- **WHEN** a signed-in user opened an invite link but never responded to it
- **THEN** that event does not appear in their list

#### Scenario: Co-host who also answered
- **WHEN** a user answered Going to an event and later became its co-host
- **THEN** the event appears once, labelled "Co-host", and not as an invite
