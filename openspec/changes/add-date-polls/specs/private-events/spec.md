# Spec Delta

## MODIFIED Requirements

### Requirement: Create private event
The system SHALL let a signed-in host create an event with only a title, a start date and time, and a location. Instead of a start date and time, the host MAY propose candidate start times for guests to vote on (see the date-polls capability). End time, description, and cover image or theme SHALL be optional.

#### Scenario: Minimal event created
- **WHEN** a host enters a title, start time and location and confirms
- **THEN** the event is created, owned by that host, and its invite link is shown ready to share

#### Scenario: Missing required field
- **WHEN** a host tries to create an event without a title, location, or either a start time or a set of candidate start times
- **THEN** the event is not created and the missing field is indicated

#### Scenario: Start time in the past
- **WHEN** a host sets a start time earlier than the current time
- **THEN** the event is not created and the host is asked to pick a future time

#### Scenario: Event created without a fixed date
- **WHEN** a host enters a title, a location and candidate start times instead of a start time and confirms
- **THEN** the event is created as date pending and its invite link is shown ready to share

### Requirement: Host event list
The system SHALL show a signed-in host their upcoming and past events, with the count of Going and Maybe responses for each. Date-pending events SHALL be listed as upcoming, before dated events, marked "Date TBD" with their number of voters instead of response counts.

#### Scenario: Host views events
- **WHEN** a host opens the app
- **THEN** they see upcoming events first, sorted by start time, each with Going and Maybe counts

#### Scenario: Host has a date-pending event
- **WHEN** a host with a date-pending event opens the app
- **THEN** that event appears at the top of upcoming events marked "Date TBD" with how many people have voted

#### Scenario: Poll waiting for a pick
- **WHEN** a date-pending event's voting deadline has passed or all its options have passed without a pick
- **THEN** the event is marked in the list as needing the host to pick or update the date
