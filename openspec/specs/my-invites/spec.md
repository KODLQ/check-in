# my-invites Specification

## Purpose
Gives a signed-in user one place in the app for the events they have been invited to and answered, next to the events they host, so guests find value in the app and are nudged to host their own events.

## Requirements

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

### Requirement: Upcoming first ordering
The list SHALL show upcoming events first, ordered by start time ascending, followed by past events ordered by start time descending.

#### Scenario: Mixed upcoming and past events
- **WHEN** a user has two upcoming events and one past event in the list
- **THEN** the two upcoming events appear first, soonest first, followed by the past event

### Requirement: Own answer shown
Each invite in the list SHALL show the user's own current answer (Going, Maybe or Can't go), the event title, start time and host display name.

#### Scenario: Answer shown on list item
- **WHEN** a user answered Maybe to an invite
- **THEN** the list item for that event shows "Maybe" as their answer

### Requirement: Change answer in the app
For an invite whose event is neither cancelled nor ended, the app SHALL let the user change their answer or withdraw their response. This SHALL work even if the event's invite link has since been revoked. A change SHALL update the existing response, not create a new one.

#### Scenario: Change from Maybe to Going
- **WHEN** a user opens an upcoming invite they answered Maybe and taps Going
- **THEN** their single response for that event becomes Going and the host's guest list shows the change

#### Scenario: Withdraw from the app
- **WHEN** a user withdraws their response to an upcoming invite
- **THEN** the response is removed from the event and the event disappears from their list

#### Scenario: Link revoked after answering
- **WHEN** the host regenerated the invite link after the user answered
- **THEN** the user can still see the event in their list and change their answer in the app

### Requirement: Past and cancelled invites marked
Invites for events that have ended or been cancelled SHALL stay in the list, visibly marked as past or cancelled. The app SHALL NOT accept answer changes for them.

#### Scenario: Cancelled invite
- **WHEN** the host cancels an event the user answered Going to
- **THEN** the event stays in the user's list marked as cancelled, with no answer options

#### Scenario: Ended invite
- **WHEN** an event the user answered has ended
- **THEN** it appears among past events, marked as past, with no answer options

### Requirement: Invite details from the list
Opening an invite from the list SHALL show the same event details and guest-list visibility a guest gets on the invite page. It SHALL also show the user's own answer.

#### Scenario: Guest list hidden by host
- **WHEN** a user opens an invite whose host has hidden the guest list
- **THEN** the details show only the number of people going, not their names

### Requirement: Only your own invites
The list and invite details SHALL only include events for which the requesting account holds a response. No user SHALL be able to see which events another user was invited to or answered.

#### Scenario: Another user's invites
- **WHEN** a signed-in user requests invites or invite details for an event they hold no response for
- **THEN** no event details are returned, and the response is the same as for an event that does not exist

#### Scenario: Signed-out request
- **WHEN** a request for invites is made without signing in
- **THEN** it is rejected

### Requirement: Create-your-own nudge
The app SHALL prompt the user to create an event when their list is empty, and when they have invites but host no upcoming events. The prompt SHALL open event creation in one tap and SHALL NOT block the list.

#### Scenario: Empty list
- **WHEN** a signed-in user with no hosted events and no invites opens the app
- **THEN** they see an empty state inviting them to plan their own event, with a button that opens event creation

#### Scenario: Only invites
- **WHEN** a signed-in user has upcoming invites but hosts no upcoming events
- **THEN** a dismissible "Plan your own" card is shown above the list
