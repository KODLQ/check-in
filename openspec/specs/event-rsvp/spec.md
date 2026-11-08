# event-rsvp Specification

## Purpose

Lets invited guests answer whether they are coming with one tap and no account, and gives the host a live, trustworthy guest list.

## Requirements

### Requirement: RSVP without account
A guest SHALL be able to respond Going, Maybe or Can't go from the invite page by entering only a display name. No account, email, phone number or app install SHALL be required. The page SHALL offer an optional email field with an unticked "Email me updates about this event" consent; an email SHALL be accepted only with the consent ticked, and the consent time SHALL be recorded.

#### Scenario: First-time guest RSVPs
- **WHEN** a guest enters a display name and taps Going on an active invite
- **THEN** their response is saved and shown back to them as their current answer

#### Scenario: Missing name
- **WHEN** a guest taps a response without entering a display name
- **THEN** the response is not saved and they are asked for a name

#### Scenario: Signed-in user RSVPs
- **WHEN** a signed-in user responds to an invite
- **THEN** their profile display name is used and they are not asked for a name

#### Scenario: RSVP with email updates
- **WHEN** a guest enters a name and an email, ticks "Email me updates about this event" and taps Going
- **THEN** their response is saved, they are subscribed to updates for this event only, and the consent time is recorded

#### Scenario: Email without consent
- **WHEN** a guest enters an email but leaves the consent unticked and taps a response
- **THEN** the response is not saved and they are asked to tick the consent or clear the email

#### Scenario: Consent not pre-ticked
- **WHEN** a guest opens the RSVP form for the first time
- **THEN** the email field is empty, the consent is unticked, and the form says the host will not see the email

#### Scenario: Invalid email
- **WHEN** a guest enters a malformed email with the consent ticked
- **THEN** the response is not saved and the email field shows an error

### Requirement: Change or withdraw RSVP
A guest SHALL be able to change or withdraw their response later from the same browser or device, without signing in. From the same device the guest SHALL also be able to turn email updates on or off; turning them off or withdrawing SHALL delete the stored email.

#### Scenario: Guest changes answer
- **WHEN** a guest who answered Maybe opens the invite again on the same device and taps Going
- **THEN** their existing response is updated, not duplicated

#### Scenario: Guest withdraws
- **WHEN** a guest chooses to remove their response
- **THEN** their name and response are deleted from the event, together with any email they gave for updates

#### Scenario: Different device
- **WHEN** a guest opens the invite on a device where they have not responded
- **THEN** they are treated as a new guest

#### Scenario: Turn off email updates
- **WHEN** a subscribed guest turns off email updates on the invite page
- **THEN** their response is kept, their email is deleted, and no further emails are sent about the event

#### Scenario: Add email later
- **WHEN** a guest who responded without an email later adds one with the consent ticked on the same device
- **THEN** they are subscribed to updates for this event and their response is unchanged

### Requirement: RSVP closed for inactive events
RSVPs SHALL NOT be accepted for events that are cancelled or have already ended.

#### Scenario: Event has ended
- **WHEN** a guest opens the invite after the event's end (or 12 hours after start when no end time is set)
- **THEN** the page shows the event as past and offers no RSVP options

### Requirement: Host guest list
The host SHALL see all responses grouped by Going, Maybe and Can't go, with counts. The list SHALL update live while the host has it open.

#### Scenario: New response while host is watching
- **WHEN** a guest RSVPs while the host has the guest list open
- **THEN** the guest appears in the right group within a few seconds without a manual refresh

### Requirement: Guest list visibility
The host SHALL choose whether guests can see the guest list. When shown, guests SHALL see display names and responses for Going and Maybe only. Can't go responses SHALL be visible only to the host.

#### Scenario: Guest list hidden
- **WHEN** the host has hidden the guest list and a guest opens the invite
- **THEN** the guest sees only the number of people going, not their names

#### Scenario: Guest list shown
- **WHEN** the host has enabled the guest list
- **THEN** guests see the names of people who answered Going and Maybe, but not Can't go

### Requirement: Remove guest
The host SHALL be able to remove any response from their event.

#### Scenario: Host removes a guest
- **WHEN** the host removes a guest's response
- **THEN** it disappears from the guest list for everyone

### Requirement: Abuse limits
The system SHALL limit how many RSVPs can be created per invite link and per client in a short period, to prevent guest-list spam.

#### Scenario: Flood of RSVPs
- **WHEN** a single client submits RSVPs to an event faster than the allowed rate
- **THEN** further RSVPs from that client are rejected with a "try again later" message
