# Spec Delta

## Purpose

Lets a host cap how many people can attend a private event and fills freed spots fairly from a waitlist, so the guest list never exceeds the room.

## ADDED Requirements

### Requirement: Capacity counts heads
An event's capacity SHALL be compared against the number of attending heads: each guest answering Going counts as one plus their plus-ones. Maybe, Can't go and waitlisted answers SHALL NOT count toward capacity. An event without a capacity SHALL have no attendee limit.

#### Scenario: Plus-ones use capacity
- **WHEN** an event has capacity 10 and three guests are Going with 0, 1 and 2 plus-ones
- **THEN** 6 of 10 spots are taken and 4 remain

#### Scenario: No capacity set
- **WHEN** an event has no capacity
- **THEN** every Going answer is accepted and no waitlist is offered

### Requirement: Join waitlist when full
When a Going answer, including its plus-ones, does not fit in the remaining spots, the system SHALL save the guest on the event's waitlist instead of as Going and SHALL tell them they are waitlisted and their position. Waitlisted guests SHALL keep their requested plus-ones.

#### Scenario: Going answer exceeds capacity
- **WHEN** an event has 1 spot left and a new guest answers Going with 1 plus-one
- **THEN** the guest is saved as waitlisted, not Going, and sees "You're on the waitlist — #1"

#### Scenario: Answer fits exactly
- **WHEN** an event has 2 spots left and a new guest answers Going with 1 plus-one
- **THEN** the guest is saved as Going and the event becomes full

### Requirement: Full event invite state
When no spot is left, the invite page SHALL show the event as full and offer "Join waitlist" in place of Going. Maybe and Can't go SHALL remain available.

#### Scenario: Guest opens a full event
- **WHEN** a guest without an answer opens the invite of an event whose Going heads equal its capacity
- **THEN** the page shows "Full — join waitlist" instead of Going, plus Maybe and Can't go

### Requirement: Waitlist order and position
The waitlist SHALL be ordered by the time each guest joined it. A waitlisted guest SHALL see their current position on the invite page. Changing only the plus-one count while waitlisted SHALL keep the guest's place.

#### Scenario: Position after someone ahead leaves
- **WHEN** the guest at position 1 withdraws and the guest at position 2 reloads the invite
- **THEN** that guest now sees position 1

#### Scenario: Waitlisted guest changes plus-ones
- **WHEN** a waitlisted guest changes their plus-ones from 2 to 1
- **THEN** they stay on the waitlist at the same position unless the new party size fits a free spot

### Requirement: Leave the waitlist
A waitlisted guest SHALL leave the waitlist when they answer Maybe or Can't go or withdraw their response.

#### Scenario: Waitlisted guest switches to Maybe
- **WHEN** a waitlisted guest answers Maybe
- **THEN** they are removed from the waitlist and shown as Maybe

### Requirement: Automatic promotion
Whenever spots free up on an active event, the system SHALL promote waitlisted guests to Going in waitlist order, skipping any guest whose party does not fit the remaining spots and continuing with the next one, until no remaining waitlisted guest fits.

#### Scenario: Going guest withdraws
- **WHEN** an event is full, a Going guest with no plus-ones withdraws, and the first waitlisted guest has no plus-ones
- **THEN** that waitlisted guest becomes Going and the event is full again

#### Scenario: First in line does not fit
- **WHEN** 1 spot frees up, the first waitlisted guest needs 3 spots and the second needs 1
- **THEN** the second guest is promoted and the first stays first on the waitlist

#### Scenario: Host raises capacity
- **WHEN** the host raises capacity from 10 to 12 while two single guests are waitlisted
- **THEN** both are promoted to Going

#### Scenario: Event no longer active
- **WHEN** a spot frees up on an event that is cancelled or has ended
- **THEN** no one is promoted

### Requirement: No overbooking under concurrency
Admitting a guest as Going and promoting from the waitlist SHALL be atomic per event, so that concurrent answers never take an event's Going heads above its capacity. Only a host's explicit manual promotion MAY exceed capacity.

#### Scenario: Two guests take the last spot at once
- **WHEN** an event has 1 spot left and two guests answer Going at the same moment
- **THEN** exactly one is saved as Going and the other is waitlisted

#### Scenario: Withdraw and new answer race
- **WHEN** a single Going guest withdraws at the same moment a new single guest answers Going on a full event whose first waitlisted guest is also single
- **THEN** the freed spot goes to the first waitlisted guest, the new guest is waitlisted behind them, and Going heads equal capacity

### Requirement: Lowering capacity keeps current guests
When a host sets capacity below the current Going heads, the system SHALL keep every Going guest and SHALL send new Going answers to the waitlist until Going heads are below capacity again.

#### Scenario: Capacity lowered below Going
- **WHEN** 12 heads are Going and the host lowers capacity to 10
- **THEN** all 12 stay Going, the host sees "12 / 10", and the next new Going answer is waitlisted

#### Scenario: Removing capacity
- **WHEN** the host clears the capacity of an event with a waitlist
- **THEN** every waitlisted guest is promoted to Going

### Requirement: Host manages waitlist
The host SHALL be able to promote any waitlisted guest to Going or remove them, regardless of their waitlist position. Promoting past capacity SHALL require the host to confirm and SHALL be allowed.

#### Scenario: Host promotes a waitlisted guest
- **WHEN** the host promotes the third guest on the waitlist while spots remain
- **THEN** that guest becomes Going and the others keep their order

#### Scenario: Host promotes past capacity
- **WHEN** the host promotes a waitlisted guest on a full event and confirms going over capacity
- **THEN** that guest becomes Going and the Going heads exceed capacity

#### Scenario: Non-host tries to promote
- **WHEN** anyone other than the host tries to promote a waitlisted guest
- **THEN** the request is rejected and nothing changes

### Requirement: Promotion notice
A guest promoted from the waitlist SHALL see that they got a spot the next time they open the invite, without needing any notification channel. When the event-updates notification capability is available, the system SHALL also notify them through it.

#### Scenario: Promoted guest opens invite
- **WHEN** a guest who was promoted opens the invite on the same device
- **THEN** the page shows "You got a spot!" with their answer as Going

#### Scenario: Notifications unavailable
- **WHEN** a guest is promoted and no notification can be delivered to them
- **THEN** their response is still Going in the host list and on the invite page
