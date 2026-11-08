# Spec Delta

## MODIFIED Requirements

### Requirement: RSVP without account
A guest SHALL be able to respond Going, Maybe or Can't go from the invite page by entering only a display name. No account, email, phone number or app install SHALL be required. When the host allows plus-ones, a guest answering Going SHALL be able to add between 0 and the host's maximum plus-ones; Maybe and Can't go SHALL carry no plus-ones.

#### Scenario: First-time guest RSVPs
- **WHEN** a guest enters a display name and taps Going on an active invite
- **THEN** their response is saved and shown back to them as their current answer

#### Scenario: Missing name
- **WHEN** a guest taps a response without entering a display name
- **THEN** the response is not saved and they are asked for a name

#### Scenario: Signed-in user RSVPs
- **WHEN** a signed-in user responds to an invite
- **THEN** their profile display name is used and they are not asked for a name

#### Scenario: Going with plus-ones
- **WHEN** the host allows up to 2 plus-ones and a guest answers Going with 2 plus-ones
- **THEN** their response is saved as Going with 2 plus-ones and shown back as "Going +2"

#### Scenario: Plus-ones not allowed
- **WHEN** the host has not allowed plus-ones
- **THEN** the invite page offers no plus-one choice and a request with plus-ones is rejected

#### Scenario: Too many plus-ones
- **WHEN** a guest submits more plus-ones than the host's maximum
- **THEN** the response is not saved and the guest is told the maximum

#### Scenario: Maybe drops plus-ones
- **WHEN** a guest who was Going +2 answers Maybe
- **THEN** their response is saved as Maybe with no plus-ones

### Requirement: Change or withdraw RSVP
A guest SHALL be able to change or withdraw their response, including their number of plus-ones, later from the same browser or device, without signing in. A change or withdrawal that frees spots SHALL let waitlisted guests be promoted.

#### Scenario: Guest changes answer
- **WHEN** a guest who answered Maybe opens the invite again on the same device and taps Going
- **THEN** their existing response is updated, not duplicated

#### Scenario: Guest withdraws
- **WHEN** a guest chooses to remove their response
- **THEN** their name and response are deleted from the event

#### Scenario: Different device
- **WHEN** a guest opens the invite on a device where they have not responded
- **THEN** they are treated as a new guest

#### Scenario: Going guest lowers plus-ones
- **WHEN** a Going guest on a full event with a waitlist changes from +2 to +0
- **THEN** their response stays Going +0 and the 2 freed spots go to waitlisted guests

#### Scenario: Going guest adds plus-ones beyond capacity
- **WHEN** a Going guest asks for more plus-ones than there are spots left
- **THEN** the change is rejected, they keep their current Going answer, and they are told how many spots are left

### Requirement: Host guest list
The host SHALL see all responses grouped by Going, Maybe, Can't go and Waitlist, with counts. The Going and Waitlist counts SHALL count heads including plus-ones, each guest with plus-ones SHALL show "+N", and the Waitlist SHALL be shown in order. The list SHALL update live while the host has it open.

#### Scenario: New response while host is watching
- **WHEN** a guest RSVPs while the host has the guest list open
- **THEN** the guest appears in the right group within a few seconds without a manual refresh

#### Scenario: Guest with plus-ones in host list
- **WHEN** one guest is Going +2 and another Going with none
- **THEN** the host sees Going · 4, with "+2" next to the first guest's name

#### Scenario: Capacity shown to host
- **WHEN** the event has a capacity of 20 and 18 heads are Going
- **THEN** the host sees "18 / 20" for Going and the waitlist below in join order

#### Scenario: Promotion while host is watching
- **WHEN** a waitlisted guest is promoted while the host has the guest list open
- **THEN** the guest moves from Waitlist to Going within a few seconds without a manual refresh

### Requirement: Guest list visibility
The host SHALL choose whether guests can see the guest list. When shown, guests SHALL see display names, responses and plus-one counts for Going and Maybe only. Can't go and waitlisted responses SHALL be visible only to the host. Counts shown to guests SHALL count heads including plus-ones.

#### Scenario: Guest list hidden
- **WHEN** the host has hidden the guest list and a guest opens the invite
- **THEN** the guest sees only the number of people going, not their names

#### Scenario: Guest list shown
- **WHEN** the host has enabled the guest list
- **THEN** guests see the names of people who answered Going and Maybe, but not Can't go

#### Scenario: Going count includes plus-ones
- **WHEN** two guests are Going, one of them with 3 plus-ones
- **THEN** the invite page says 5 people are going

#### Scenario: Waitlist names hidden from guests
- **WHEN** an event has waitlisted guests and the guest list is shown
- **THEN** guests see the number of people on the waitlist but not their names

### Requirement: Remove guest
The host SHALL be able to remove any response from their event. Removing a Going guest SHALL free their spots for waitlisted guests.

#### Scenario: Host removes a guest
- **WHEN** the host removes a guest's response
- **THEN** it disappears from the guest list for everyone

#### Scenario: Removal frees spots
- **WHEN** the host removes a Going +1 guest from a full event with a waitlist
- **THEN** the 2 freed spots are filled from the waitlist
