# Spec Delta

## ADDED Requirements

### Requirement: Group invitation notice
When a group owner or admin invites a user, that user SHALL get a push notification naming the group and the person who invited them. Tapping it SHALL open the invitation in the app.

#### Scenario: Invited to a group
- **WHEN** Anna invites Erik to "AW crew"
- **THEN** Erik gets a push saying Anna invited them to "AW crew", which opens the invitation

### Requirement: Group join notice
When someone joins a group by link or accepts an invitation, the owner SHALL be notified. Several joins within 15 minutes SHALL produce one notification listing them.

#### Scenario: Two people join quickly
- **WHEN** two people join "AW crew" within five minutes
- **THEN** the owner gets one notification naming both

### Requirement: New owner notice
When a group's ownership passes to someone, by handover or because the owner deleted their account, the new owner SHALL get a push naming the group.

#### Scenario: Ownership handed over
- **WHEN** Anna hands "AW crew" over to Erik
- **THEN** Erik gets a push saying they now own "AW crew"

### Requirement: New date notice for group members
When an event that invites a group is created, or a new date of a series that invites a group is created, members SHALL get a push asking if they are in. Members who already answered and those who manage the event (its owner and co-hosts, and for a series date the group's admins) SHALL NOT get it. It SHALL follow quiet hours.

#### Scenario: Next After Work created
- **WHEN** the date for Friday 27 Nov of a weekly series inviting "AW crew" is created
- **THEN** members get a push about "AW" on Friday 27 Nov that opens the invite

#### Scenario: Member answered before send
- **WHEN** a member answers a new date while its notice is waiting for quiet hours to end
- **THEN** that member does not receive the notice

### Requirement: Reminder for members who have not answered
About 24 hours before a group event starts, members who still have not answered SHALL get one push reminding them to answer. It SHALL not be sent if the event was created less than 24 hours before it starts, and SHALL follow quiet hours.

#### Scenario: Member forgot to answer
- **WHEN** it is 24 hours before Friday's AW and a member of the invited group has not answered
- **THEN** they get one push asking if they are coming, which opens the invite

#### Scenario: Member answered
- **WHEN** a member answered Can't go before the reminder is sent
- **THEN** they do not get the reminder

#### Scenario: Event created at short notice
- **WHEN** a group event is created 10 hours before it starts
- **THEN** no reminder is sent, only the new date notice

### Requirement: No duplicate notices for a new series
Creating a series SHALL send one new-date notice for its first date only, not one per date created at the same time.

#### Scenario: Series created
- **WHEN** a host creates a weekly series inviting a group, creating its first four dates
- **THEN** members get one notice, about the first date
