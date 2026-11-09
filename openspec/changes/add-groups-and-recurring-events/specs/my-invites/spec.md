# Spec Delta

## MODIFIED Requirements

### Requirement: Invites listed with hosted events
The app SHALL show a signed-in user every event they hold an RSVP for through their account (Going, Maybe, Can't go or on the waitlist), every upcoming event that invites a group they belong to, together with the events they host or co-host. Each item SHALL be labelled as hosted by the user, co-hosted by the user, or an invite. An event the user hosts or co-hosts SHALL appear only once, as hosted or co-hosted.

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

#### Scenario: Group event not answered yet
- **WHEN** a member of "AW crew" opens the app while an upcoming event invites that group
- **THEN** the event is listed as an invite marked "Not answered yet"

### Requirement: Change answer in the app
For an invite whose event is neither cancelled nor ended, the app SHALL let the user change their answer or withdraw their response. This SHALL work even if the event's invite link has since been revoked. A change SHALL update the existing response, not create a new one. When the host allows plus-ones, the user SHALL be able to change their plus-ones, and the event's capacity and waitlist rules SHALL apply as on the invite page. A group member SHALL be able to give a first answer in the app to an event that invites their group.

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

#### Scenario: First answer from a group member
- **WHEN** a group member taps Going on a group event they had not answered
- **THEN** a response linked to their account is created with their display name and the host sees them as Going

#### Scenario: Group member withdraws
- **WHEN** a group member withdraws their answer to an upcoming group event
- **THEN** the response is removed and the event shows as "Not answered yet" again

### Requirement: Only your own invites
The list and invite details SHALL only include events for which the requesting account holds a response, or which invite a group the account currently belongs to. No user SHALL be able to see which events another user was invited to or answered.

#### Scenario: Another user's invites
- **WHEN** a signed-in user requests invites or invite details for an event they hold no response for and whose group they do not belong to
- **THEN** no event details are returned, and the response is the same as for an event that does not exist

#### Scenario: Signed-out request
- **WHEN** a request for invites is made without signing in
- **THEN** it is rejected

#### Scenario: Former member
- **WHEN** a user who left a group requests details of a group event they never answered
- **THEN** no event details are returned

## ADDED Requirements

### Requirement: Series invites grouped in the list
Upcoming invites that are dates of the same series SHALL appear as one item showing the next date, the user's answer for it, the repeat rule, and how many later dates the user has not answered. Opening the item SHALL show every upcoming date of the series with the user's answer for each.

#### Scenario: Weekly group series
- **WHEN** a member of a group invited to a weekly series with four upcoming dates opens the app
- **THEN** they see one item for the series showing the next Friday, "Every Friday" and "3 more dates not answered"

#### Scenario: Answering a later date
- **WHEN** the member opens the item and answers Going to the third date
- **THEN** that date shows Going and the item shows "2 more dates not answered"
