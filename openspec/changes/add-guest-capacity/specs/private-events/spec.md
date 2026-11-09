# Spec Delta

## MODIFIED Requirements

### Requirement: Create private event
The system SHALL let a signed-in host create an event with only a title, a start date and time, and a location. End time, description, cover image or theme, plus-ones (off by default, with a maximum of 1 to 5 per guest when on) and capacity (a whole number of attendees, unlimited by default) SHALL be optional.

#### Scenario: Minimal event created
- **WHEN** a host enters a title, start time and location and confirms
- **THEN** the event is created, owned by that host, and its invite link is shown ready to share

#### Scenario: Missing required field
- **WHEN** a host tries to create an event without a title, start time or location
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
