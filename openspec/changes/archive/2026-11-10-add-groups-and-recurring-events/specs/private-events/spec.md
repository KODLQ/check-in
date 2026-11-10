# Spec Delta

## ADDED Requirements

### Requirement: Invite a group to an event
When creating or editing a one-off event, its owner SHALL be able to pick one group they own or are an admin of to invite. Members of that group SHALL be invited in the app without needing the link. The guest invite link SHALL keep working for everyone else. Series always invite their own group (see recurring-events).

#### Scenario: Group invited on creation
- **WHEN** a host creates an event and picks their group "AW crew"
- **THEN** every member of "AW crew" sees the event in their app as an invite they have not answered

#### Scenario: Member who joins later
- **WHEN** someone joins "AW crew" while an upcoming event invites it
- **THEN** that event appears in their app as an invite they have not answered

#### Scenario: Outside guests on a group event
- **WHEN** a one-off event invites "AW crew" and the host also shares its link with a friend who has no account
- **THEN** the friend can answer on the web like any guest and appears on the guest list next to the members

#### Scenario: Regular member cannot pick the group
- **WHEN** a regular member of "AW crew" creates an event
- **THEN** "AW crew" is not offered as a group to invite, and the backend rejects it if sent directly

#### Scenario: Co-host cannot pick a group
- **WHEN** a co-host edits an event
- **THEN** they cannot change which group is invited

### Requirement: Group invite ends when admin rights end
When the owner of a one-off event stops being owner or admin of the group it invites (demoted, left or removed), their upcoming events SHALL stop inviting that group. Members who answered SHALL keep their answers. This SHALL NOT apply to series, which belong to the group.

#### Scenario: Admin demoted
- **WHEN** Erik's one-off party invites "AW crew" and Erik is made a regular member
- **THEN** the party no longer invites the group, and members who answered Going stay on the guest list

### Requirement: Remove the group from an event
The owner SHALL be able to stop inviting a group to a one-off event. Members who had not answered SHALL no longer see the event; members who answered SHALL keep their answer.

#### Scenario: Group removed from event
- **WHEN** the owner removes the group from an upcoming one-off event
- **THEN** members without an answer no longer see it and Going members stay on the guest list

### Requirement: Series in the host list
In the event list of the group's owner and admins, a series SHALL appear as its next upcoming date, labelled with the group name and the repeat rule (for example "AW crew · Every Friday"), with that date's response counts. The other upcoming dates SHALL be reachable from it. Past dates SHALL appear among past events.

#### Scenario: Admin with a weekly series
- **WHEN** an admin of "AW crew", which has a weekly series, opens the app
- **THEN** they see one item for the series, showing the next date, "AW crew · Every Friday" and that date's Going and Maybe counts

### Requirement: Not-answered count for group events
For an event that invites a group, those who manage it SHALL see how many members have not answered yet, next to the Going, Maybe and Can't go counts.

#### Scenario: Members yet to answer
- **WHEN** an event invites a group of 12 members and 5 of them have answered
- **THEN** the host sees "7 not answered" with the guest counts
