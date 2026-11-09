# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
