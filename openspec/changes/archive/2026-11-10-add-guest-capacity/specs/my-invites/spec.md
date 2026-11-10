# Spec Delta

## MODIFIED Requirements

### Requirement: Invites listed with hosted events
The app SHALL show a signed-in user every event they hold an RSVP for through their account (Going, Maybe, Can't go or on the waitlist), together with the events they host or co-host. Each item SHALL be labelled as hosted by the user, co-hosted by the user, or an invite. An event the user hosts or co-hosts SHALL appear only once, as hosted or co-hosted.

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

### Requirement: Own answer shown
Each invite in the list SHALL show the user's own current answer (Going, Maybe, Can't go or Waitlist), the event title, start time and host display name. A Going answer with plus-ones SHALL show them ("Going +2").

#### Scenario: Answer shown on list item
- **WHEN** a user answered Maybe to an invite
- **THEN** the list item for that event shows "Maybe" as their answer

#### Scenario: Waitlisted invite
- **WHEN** a user's Going answer was put on the event's waitlist
- **THEN** the list item shows "Waitlist" as their answer

### Requirement: Change answer in the app
For an invite whose event is neither cancelled nor ended, the app SHALL let the user change their answer or withdraw their response. This SHALL work even if the event's invite link has since been revoked. A change SHALL update the existing response, not create a new one. When the host allows plus-ones, the user SHALL be able to change their plus-ones, and the event's capacity and waitlist rules SHALL apply as on the invite page.

#### Scenario: Change from Maybe to Going
- **WHEN** a user opens an upcoming invite they answered Maybe and taps Going
- **THEN** their single response for that event becomes Going and the host's guest list shows the change

#### Scenario: Withdraw from the app
- **WHEN** a user withdraws their response to an upcoming invite
- **THEN** the response is removed from the event and the event disappears from their list

#### Scenario: Link revoked after answering
- **WHEN** the host regenerated the invite link after the user answered
- **THEN** the user can still see the event in their list and change their answer in the app

#### Scenario: Going on a full event from the app
- **WHEN** a user who answered Maybe taps Going on an invite whose event is full
- **THEN** they are put on the waitlist and see their position

#### Scenario: Withdraw frees a spot
- **WHEN** a Going user withdraws from the app on a full event with a waitlist
- **THEN** the first waitlisted guest who fits is promoted
