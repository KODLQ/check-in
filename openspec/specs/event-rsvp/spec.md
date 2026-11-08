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
A guest SHALL be able to change or withdraw their response later from the same browser or device, without signing in. From the same device the guest SHALL also be able to turn email updates on or off; turning them off or withdrawing SHALL delete the stored email. Changing or withdrawing SHALL remain possible from the same browser after the response has been claimed by an account.

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

#### Scenario: Same browser after claiming
- **WHEN** a guest whose web response was claimed into their account opens the invite again in the same browser and taps Can't go
- **THEN** the claimed response is updated, the account still holds it, and no duplicate response is created

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

### Requirement: Claim web RSVPs into an account
A signed-in app user SHALL be able to claim the responses made from a browser. To do so they redeem a claim code that only that browser can create. Claiming SHALL link every response that browser made to the account, including responses to ended and cancelled events. Responses SHALL NOT be claimable by display name or any other guessable detail.

#### Scenario: Guest installs the app and signs in
- **WHEN** a guest who answered two invites on the web uses the hand-off from that browser and then signs in to the app
- **THEN** both responses are linked to their account and appear in their invites list

#### Scenario: Claim attempted by name
- **WHEN** someone tries to claim responses using only a guest's display name or an event link
- **THEN** no responses are linked

#### Scenario: Email updates replaced by push
- **WHEN** a guest who turned on email updates on the web claims that response into their account
- **THEN** their email address for that event is deleted, and they get updates as an app user instead

#### Scenario: Nothing to claim
- **WHEN** a valid claim code is redeemed for a browser that has no responses
- **THEN** the claim succeeds with zero responses linked

### Requirement: Claim merges duplicate responses
When a claimed response is for an event on which the account already has a response, the system SHALL keep exactly one response for that account. It SHALL hold the most recently updated answer. The other response SHALL be removed.

#### Scenario: Account already answered the same event
- **WHEN** an account answered Maybe in the app, the browser later answered Going on the web, and the browser's responses are claimed
- **THEN** the account has a single response for that event with the answer Going

#### Scenario: Account answer is newer
- **WHEN** the account's existing response was updated after the browser's response
- **THEN** the account keeps its existing answer and the browser's response is removed

### Requirement: Identity after claiming
After claiming, a response SHALL belong to the account. It SHALL keep its display name until the user changes it. Changing the answer from the app SHALL NOT replace the display name. Hosts SHALL see the same name and answer as before the claim and SHALL NOT gain access to any account details.

#### Scenario: Name kept
- **WHEN** a guest who answered as "Sara B" claims into an account whose profile name is "Sara Berg" and then changes the answer in the app
- **THEN** the host's guest list still shows "Sara B" with the new answer

#### Scenario: Host view unchanged
- **WHEN** a host views their guest list after one of the guests claimed their response
- **THEN** the guest appears with the same name and answer, and no email, avatar or other account detail is shown

### Requirement: Claim code limits
A claim code SHALL be random and unguessable, single-use, and valid for at most 24 hours. Unknown, expired and already-used codes SHALL produce the same failure. Claim attempts SHALL be rate-limited per account, and code creation SHALL be rate-limited per client.

#### Scenario: Code reused
- **WHEN** a claim code that was already redeemed is redeemed again by any account
- **THEN** the claim fails with the same message as for an unknown code and no responses are linked

#### Scenario: Code expired
- **WHEN** a claim code is redeemed more than 24 hours after it was created
- **THEN** the claim fails and the user is told to start the hand-off again from the invite page

#### Scenario: Guessing codes
- **WHEN** an account submits claim codes faster than the allowed rate
- **THEN** further attempts are rejected with a "try again later" message
