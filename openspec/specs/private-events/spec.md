# private-events Specification

## Purpose

Lets a host create and manage a private event quickly, so that organising a party or meetup is faster than writing it in a group chat.

## Requirements

### Requirement: Create private event
The system SHALL let a signed-in host create an event with only a title, a start date and time, and a location. Instead of a start date and time, the host MAY propose candidate start times for guests to vote on (see the date-polls capability). End time, description, cover image or theme, plus-ones (off by default, with a maximum of 1 to 5 per guest when on) and capacity (a whole number of attendees, unlimited by default) SHALL be optional.

#### Scenario: Minimal event created
- **WHEN** a host enters a title, start time and location and confirms
- **THEN** the event is created, owned by that host, and its invite link is shown ready to share

#### Scenario: Missing required field
- **WHEN** a host tries to create an event without a title, location, or either a start time or a set of candidate start times
- **THEN** the event is not created and the missing field is indicated

#### Scenario: Start time in the past
- **WHEN** a host sets a start time earlier than the current time
- **THEN** the event is not created and the host is asked to pick a future time

#### Scenario: Defaults without guest settings
- **WHEN** a host creates an event without touching plus-ones or capacity
- **THEN** guests cannot add plus-ones and the event has no attendee limit

#### Scenario: Plus-ones and capacity set
- **WHEN** a host turns on plus-ones with a maximum of 2 and sets capacity to 25
- **THEN** the event is created and guests can bring up to 2 plus-ones until 25 people are going

#### Scenario: Invalid guest settings
- **WHEN** a host sets a plus-one maximum outside 1 to 5 or a capacity below 1
- **THEN** the event is not saved and the invalid field is indicated

#### Scenario: Event created without a fixed date
- **WHEN** a host enters a title, a location and candidate start times instead of a start time and confirms
- **THEN** the event is created as date pending and its invite link is shown ready to share

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
An event SHALL only be visible to its host (the owner), its co-hosts, and people who have its invite link. Events SHALL NOT appear in any search, listing or discovery surface.

#### Scenario: No link, no access
- **WHEN** someone without the invite link who is not the owner or a co-host tries to find or access the event
- **THEN** no event details are returned

#### Scenario: Co-host access
- **WHEN** a co-host opens the event in the app
- **THEN** they see the full event details without needing the invite link

### Requirement: Edit event
The system SHALL let the host and co-hosts edit any event field, including plus-one and capacity settings, until the event has ended. Guests SHALL see the latest details the next time they view the invite. Changing these settings SHALL NOT remove or change existing responses.

#### Scenario: Host changes time
- **WHEN** a host changes the start time of an upcoming event
- **THEN** the invite page shows the new time and marks that the time was updated

#### Scenario: Co-host changes time
- **WHEN** a co-host changes the start time of an upcoming event
- **THEN** the invite page shows the new time and marks that the time was updated

#### Scenario: Non-host cannot edit
- **WHEN** anyone other than the host or a co-host attempts to change the event
- **THEN** the change is rejected

#### Scenario: Co-host raises capacity
- **WHEN** a co-host raises the capacity of an event with waitlisted guests
- **THEN** the change is saved and waitlisted guests who now fit are promoted, as when the owner does it

#### Scenario: Host turns off plus-ones
- **WHEN** a host turns off plus-ones while some guests are Going with plus-ones
- **THEN** those guests keep their plus-ones and new or changed answers cannot add any

#### Scenario: Host lowers plus-one maximum
- **WHEN** a host lowers the maximum from 3 to 1 while a guest is Going +3
- **THEN** that guest stays Going +3 until they change their answer, which must then respect the new maximum

### Requirement: Cancel event
The system SHALL let the host (the owner) cancel an event. Co-hosts SHALL NOT be able to cancel it. A cancelled event's invite page SHALL show it as cancelled and SHALL NOT accept RSVPs.

#### Scenario: Guest opens cancelled event
- **WHEN** a guest opens the invite link of a cancelled event
- **THEN** the page shows the event title and that it was cancelled, with no RSVP options

#### Scenario: Co-host cannot cancel
- **WHEN** a co-host attempts to cancel the event
- **THEN** the request is rejected, the event stays active, and the app does not offer the cancel action to co-hosts

### Requirement: Host event list
The system SHALL show a signed-in host their upcoming and past events, including events they co-host, with the count of Going and Maybe responses for each. Events they co-host SHALL be labelled "Co-host". The Going count SHALL include plus-ones, and events with a capacity SHALL show the Going count against it.

#### Scenario: Host views events
- **WHEN** a host opens the app
- **THEN** they see upcoming events first, sorted by start time, each with Going and Maybe counts

#### Scenario: Co-hosted event in list
- **WHEN** a user who co-hosts an upcoming event opens the app
- **THEN** that event appears among their upcoming events in start-time order, with Going and Maybe counts and a "Co-host" label

#### Scenario: Co-host removed
- **WHEN** a user stops being a co-host of an event and refreshes their event list
- **THEN** that event no longer appears in their list

#### Scenario: Event with capacity and plus-ones
- **WHEN** an event with capacity 30 has 10 Going guests bringing 4 plus-ones in total
- **THEN** the host's event list shows "14 / 30 going"

### Requirement: Date-pending events in the host list
In the host event list, date-pending events the user owns or co-hosts SHALL be listed as upcoming, before every dated event and invite, marked "Date TBD" with their number of voters instead of response counts. An event whose voting deadline has passed, or whose options have all passed, without a pick SHALL be marked as needing a date to be picked.

#### Scenario: Host has a date-pending event
- **WHEN** a host with a date-pending event opens the app
- **THEN** that event appears at the top of upcoming events marked "Date TBD" with how many people have voted

#### Scenario: Co-host sees a date-pending event
- **WHEN** a co-host of a date-pending event opens the app
- **THEN** the event appears at the top of their upcoming events marked "Date TBD" with the "Co-host" label

#### Scenario: Poll waiting for a pick
- **WHEN** a date-pending event's voting deadline has passed or all its options have passed without a pick
- **THEN** the event is marked in the list as needing the host to pick or update the date

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
