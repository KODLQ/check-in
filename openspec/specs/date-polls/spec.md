# date-polls Specification

## Purpose
Lets a host send an invite before the date is fixed, collect guests' availability for a few candidate start times inside the invite, and turn the winning option into the event's date and RSVPs.

## Requirements

### Requirement: Create event with a date poll
The system SHALL let a signed-in host create an event with 2 to 4 candidate start times instead of a single start time. Each option MAY have an end time after its start. The event SHALL be "date pending" until an option is picked, and its invite link SHALL work immediately.

#### Scenario: Poll event created
- **WHEN** a host enters a title, a location and three future candidate start times and confirms
- **THEN** the event is created as date pending with three options, and its invite link is shown ready to share

#### Scenario: Too few or too many options
- **WHEN** a host tries to create a poll with one option or with five options
- **THEN** the event is not created and the host is told a poll needs 2 to 4 options

#### Scenario: Duplicate options
- **WHEN** two options have the same start time
- **THEN** the event is not created and the duplicate option is indicated

#### Scenario: Option end before start
- **WHEN** an option has an end time at or before its start time
- **THEN** the event is not created and that option's end time is indicated

### Requirement: Candidate times must be in the future
The system MUST reject any new or changed candidate start time that is not later than the current time, whether entered at creation or while editing options.

#### Scenario: Option in the past at creation
- **WHEN** a host creates a poll where one option starts earlier than now
- **THEN** the event is not created and that option is indicated as in the past

#### Scenario: Option in the past while editing
- **WHEN** a host changes an option of an open poll to a time earlier than now
- **THEN** the change is rejected and the existing options and votes are kept

### Requirement: Optional voting deadline
The host MAY set a voting deadline later than now and no later than the earliest option's start. After the deadline, votes SHALL NOT be accepted, the host SHALL still be able to pick, and no option SHALL be picked automatically. The host MAY change or remove the deadline before picking.

#### Scenario: Deadline passes
- **WHEN** a guest opens the invite after the voting deadline and before the host picks
- **THEN** the page shows the options and tallies, says voting has closed, and offers no vote controls

#### Scenario: Host extends deadline
- **WHEN** the host moves the deadline of a closed, unpicked poll to a later future time
- **THEN** guests can vote again until the new deadline

#### Scenario: Deadline after first option
- **WHEN** a host sets a deadline later than the earliest option's start time
- **THEN** the deadline is rejected and the host is asked to pick an earlier one

### Requirement: Vote without account
A guest SHALL be able to answer Yes, If needed or No for each open option from the invite page by entering only a display name, using the same device identity as RSVPs. A signed-in user SHALL vote as themselves with their profile name. A guest MAY leave options unanswered.

#### Scenario: First-time guest votes
- **WHEN** a guest enters a display name, answers Yes to one option and No to another, and submits
- **THEN** their answers are saved and shown back to them as their current votes

#### Scenario: Missing name
- **WHEN** a guest submits votes without a display name
- **THEN** the votes are not saved and they are asked for a name

#### Scenario: Signed-in user votes
- **WHEN** a signed-in user votes from the app
- **THEN** their profile display name is used and they are not asked for a name

### Requirement: Change or withdraw votes
A guest SHALL be able to change or withdraw their votes from the same browser or device until the poll closes. Each device identity SHALL have at most one answer per option.

#### Scenario: Guest changes a vote
- **WHEN** a guest who answered If needed opens the invite again on the same device and answers Yes
- **THEN** their answer for that option is updated, not duplicated

#### Scenario: Guest withdraws
- **WHEN** a guest chooses to remove their votes
- **THEN** their name and all their answers are deleted from the poll

### Requirement: Voting only on open options
The system MUST NOT accept votes for an option whose start time has passed, or for any option of a poll that is cancelled, picked or past its deadline.

#### Scenario: Option time has passed
- **WHEN** a guest opens a pending invite after one option's start time has passed
- **THEN** that option is shown as passed with no vote controls, and votes for it are rejected

#### Scenario: Vote after pick
- **WHEN** a guest submits votes from a page loaded before the host picked a date
- **THEN** the votes are rejected and the page reloads showing the picked date

### Requirement: Expired poll
When every option's start time has passed without a pick, the invite page SHALL show that the date was never set and SHALL offer no voting. The host SHALL be able to revive the poll by adding future options.

#### Scenario: All options passed
- **WHEN** a guest opens a pending invite after all options' start times have passed
- **THEN** the page shows the event as not scheduled, with no vote or RSVP options

### Requirement: Vote tallies visible to guests
The invite page SHALL show, for each option, the number of Yes, If needed and No answers, and SHALL update the tallies each time the page is loaded.

#### Scenario: Guest sees tallies
- **WHEN** a guest opens the invite of a poll where four people answered Yes and one answered No to an option
- **THEN** that option shows 4 Yes and 1 No

### Requirement: Voter name visibility
Voter names SHALL follow the event's guest-list visibility setting. When the guest list is shown, guests SHALL see names of Yes and If needed voters per option. No answers' names SHALL be visible only to the host. When hidden, guests SHALL see only tallies.

#### Scenario: Guest list shown
- **WHEN** the host has enabled the guest list and a guest views an option
- **THEN** the guest sees the names of people who answered Yes and If needed, but not No

#### Scenario: Guest list hidden
- **WHEN** the host has hidden the guest list
- **THEN** guests see only the tallies per option, without names

### Requirement: Host live poll results
The host and co-hosts SHALL see every option with its tallies and the names and answers of all voters, updating live while open. The option with the most Yes answers SHALL be highlighted, with If needed answers breaking ties.

#### Scenario: Vote while host is watching
- **WHEN** a guest votes while the host has the poll results open
- **THEN** the tallies and voter names update within a few seconds without a manual refresh

#### Scenario: Co-host sees results
- **WHEN** a co-host opens a date-pending event in the app
- **THEN** they see the same tallies, voter names and answers as the owner

### Requirement: Host removes a voter
The host and co-hosts SHALL be able to remove any voter and all their answers from the poll.

#### Scenario: Spam voter removed
- **WHEN** the host removes a voter
- **THEN** that voter's name and answers disappear from the poll for everyone

### Requirement: Edit options after votes exist
While the poll is unpicked, the host and co-hosts SHALL be able to add, change and remove options within the 2 to 4 limit. Removing an option or changing its times SHALL delete that option's votes, and the host MUST be shown how many votes will be deleted and confirm first.

#### Scenario: Removing an option with votes
- **WHEN** the host removes an option that has 3 votes
- **THEN** the host is warned that 3 votes will be deleted, and only after confirming is the option removed with its votes

#### Scenario: Adding an option keeps votes
- **WHEN** the host adds a future option to a poll with existing votes
- **THEN** existing votes on other options are kept and the new option has no votes

### Requirement: Host picks the date
The host or a co-host SHALL be able to pick one option at any time before the event is cancelled. Picking SHALL set the event's start and end time to the option's, close the poll, and from then on the event SHALL behave like a normal event with that time. A pick MUST NOT be undone.

#### Scenario: Host picks an option
- **WHEN** the host picks an option and confirms
- **THEN** the event's start and end become the option's times and the invite page shows that date with RSVP options

#### Scenario: Picking an option in the past
- **WHEN** the host tries to pick an option whose start time has already passed
- **THEN** the pick is rejected and the poll stays open

#### Scenario: Co-host picks
- **WHEN** a co-host picks an option and confirms
- **THEN** the event gets that date exactly as if the owner had picked it

#### Scenario: Two managers pick at once
- **WHEN** the owner and a co-host pick different options at the same moment
- **THEN** exactly one pick is applied and the other is told a date was already picked

#### Scenario: Non-host cannot pick
- **WHEN** anyone other than the host or a co-host tries to pick an option
- **THEN** the pick is rejected

### Requirement: Votes become RSVPs on pick
When an option is picked, each voter who answered Yes to it SHALL get a Going RSVP and each who answered If needed SHALL get a Maybe RSVP, under the same name and identity. No answers and unanswered voters SHALL get no RSVP. Individual votes SHALL then be deleted, keeping only final tallies.

#### Scenario: Yes voter becomes Going
- **WHEN** the host picks an option that a guest answered Yes to
- **THEN** that guest appears as Going and sees Going as their current answer on the same device

#### Scenario: If needed voter becomes Maybe
- **WHEN** the host picks an option that a guest answered If needed to
- **THEN** that guest appears as Maybe

#### Scenario: No voter gets no RSVP
- **WHEN** the host picks an option that a guest answered No to
- **THEN** that guest has no RSVP and can still RSVP normally from the invite

### Requirement: Pick respects capacity
When the event has a capacity, Yes voters SHALL be converted in the order they first voted, and a voter whose Going answer does not fit SHALL be put on the waitlist in that order instead. Converted Going answers SHALL carry no plus-ones; the guest MAY add plus-ones afterwards under the normal RSVP rules.

#### Scenario: More Yes voters than spots
- **WHEN** the host picks an option with 5 Yes voters on an event with capacity 3
- **THEN** the first 3 voters to have voted become Going and the other 2 are waitlisted in voting order

#### Scenario: Converted guest adds a plus-one
- **WHEN** a guest converted to Going later adds a plus-one on an event that allows them
- **THEN** the answer is saved under the normal plus-one and capacity rules

### Requirement: Event details editable while pending
The host and co-hosts SHALL be able to edit every other field of a date-pending event as for a dated event. Its start and end time SHALL only be set by picking an option, and a dated event SHALL NOT be turned back into a poll.

#### Scenario: Host edits the location while pending
- **WHEN** the host changes the location of a date-pending event
- **THEN** guests see the new location on the invite page and the poll is unchanged

#### Scenario: Direct time change while pending
- **WHEN** someone tries to set a start time on a date-pending event other than by picking an option
- **THEN** the change is rejected

### Requirement: Notify voters when a date is picked
When a date is picked, the system SHALL send a "date picked" push to every voter who voted as a signed-in app user, whatever their answer. Web voters SHALL NOT be emailed, because voting collects no email address. The invite page MUST show the picked date regardless of whether any notification is delivered.

#### Scenario: App voter is notified
- **WHEN** a date is picked and a voter voted from the app with notifications allowed
- **THEN** they get one "date picked" push that opens the invite

#### Scenario: Notifications unavailable
- **WHEN** a date is picked and a voter has no way to receive notifications
- **THEN** the voter sees the picked date and their converted RSVP the next time they open the invite

### Requirement: Cancel a date-pending event
The owner SHALL be able to cancel a date-pending event; co-hosts SHALL NOT, as for any event. Its invite page SHALL then show it as cancelled and SHALL NOT accept votes or RSVPs.

#### Scenario: Guest opens cancelled poll
- **WHEN** a guest opens the invite of a cancelled date-pending event
- **THEN** the page shows the title and that it was cancelled, with no options, tallies or vote controls

### Requirement: Voting abuse limits
The system SHALL limit vote writes per client per invite in a short period to the same rate as RSVP writes, and SHALL limit the number of distinct voters per event to the same maximum as RSVPs.

#### Scenario: Flood of votes
- **WHEN** a single client submits votes to an event faster than the allowed rate
- **THEN** further submissions from that client are rejected with a "try again later" message

#### Scenario: Voter cap reached
- **WHEN** a new guest votes on an event that already has the maximum number of voters
- **THEN** their votes are rejected with a "try again later" message, while existing voters can still change theirs
