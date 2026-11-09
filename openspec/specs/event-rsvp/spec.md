# event-rsvp Specification

## Purpose

Lets invited guests answer whether they are coming with one tap and no account, and gives the host a live, trustworthy guest list.

## Requirements

### Requirement: RSVP without account
A guest SHALL be able to respond Going, Maybe or Can't go from the invite page by entering only a display name. No account, email, phone number or app install SHALL be required. The page SHALL offer an optional email field with an unticked "Email me updates about this event" consent; an email SHALL be accepted only with the consent ticked, and the consent time SHALL be recorded. When the host allows plus-ones, a guest answering Going SHALL be able to add between 0 and the host's maximum plus-ones; Maybe and Can't go SHALL carry no plus-ones.

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
A guest SHALL be able to change or withdraw their response, including their number of plus-ones, later from the same browser or device, without signing in. From the same device the guest SHALL also be able to turn email updates on or off; turning them off or withdrawing SHALL delete the stored email. Changing or withdrawing SHALL remain possible from the same browser after the response has been claimed by an account. A change or withdrawal that frees spots SHALL let waitlisted guests be promoted, and turning email updates on or off SHALL NOT change the guest's answer, plus-ones or waitlist place.

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

#### Scenario: Going guest lowers plus-ones
- **WHEN** a Going guest on a full event with a waitlist changes from +2 to +0
- **THEN** their response stays Going +0 and the 2 freed spots go to waitlisted guests

#### Scenario: Going guest adds plus-ones beyond capacity
- **WHEN** a Going guest asks for more plus-ones than there are spots left
- **THEN** the change is rejected, they keep their current Going answer, and they are told how many spots are left

#### Scenario: Waitlisted guest adds email
- **WHEN** a waitlisted guest turns on email updates
- **THEN** they stay on the waitlist at the same position with the same plus-ones

### Requirement: RSVP closed for inactive events
RSVPs SHALL NOT be accepted for events that are cancelled or have already ended.

#### Scenario: Event has ended
- **WHEN** a guest opens the invite after the event's end (or 12 hours after start when no end time is set)
- **THEN** the page shows the event as past and offers no RSVP options

### Requirement: Host guest list
The host and co-hosts SHALL see all responses grouped by Going, Maybe, Can't go and Waitlist, with counts. The Going and Waitlist counts SHALL count heads including plus-ones, each guest with plus-ones SHALL show "+N", and the Waitlist SHALL be shown in order. The list SHALL update live while the host or co-host has it open.

#### Scenario: New response while host is watching
- **WHEN** a guest RSVPs while the host has the guest list open
- **THEN** the guest appears in the right group within a few seconds without a manual refresh

#### Scenario: New response while co-host is watching
- **WHEN** a guest RSVPs while a co-host has the guest list open
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
The host or a co-host SHALL choose whether guests can see the guest list. When shown, guests SHALL see display names, responses and plus-one counts for Going and Maybe only. Can't go and waitlisted responses SHALL be visible only to the host and co-hosts. Counts shown to guests SHALL count heads including plus-ones.

#### Scenario: Guest list hidden
- **WHEN** the host has hidden the guest list and a guest opens the invite
- **THEN** the guest sees only the number of people going, not their names

#### Scenario: Guest list shown
- **WHEN** the host has enabled the guest list
- **THEN** guests see the names of people who answered Going and Maybe, but not Can't go

#### Scenario: Co-host toggles visibility
- **WHEN** a co-host hides the guest list
- **THEN** guests opening the invite see only the number of people going

#### Scenario: Going count includes plus-ones
- **WHEN** two guests are Going, one of them with 3 plus-ones
- **THEN** the invite page says 5 people are going

#### Scenario: Waitlist names hidden from guests
- **WHEN** an event has waitlisted guests and the guest list is shown
- **THEN** guests see the number of people on the waitlist but not their names

### Requirement: Remove guest
The host and co-hosts SHALL be able to remove any response from the event. Removing a Going guest SHALL free their spots for waitlisted guests.

#### Scenario: Host removes a guest
- **WHEN** the host removes a guest's response
- **THEN** it disappears from the guest list for everyone

#### Scenario: Co-host removes a guest
- **WHEN** a co-host removes a guest's response
- **THEN** it disappears from the guest list for everyone, including the owner

#### Scenario: Removal frees spots
- **WHEN** the host removes a Going +1 guest from a full event with a waitlist
- **THEN** the 2 freed spots are filled from the waitlist

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
When a claimed response is for an event on which the account already has a response, the system SHALL keep exactly one response for that account. It SHALL hold the most recently updated answer, together with its plus-ones and waitlist place. A waitlisted response SHALL count as the answer Going, so an account that is already Going SHALL NOT lose its spot to a newer waitlisted browser response. The other response SHALL be removed, and any spots it held SHALL be freed for waitlisted guests.

#### Scenario: Account already answered the same event
- **WHEN** an account answered Maybe in the app, the browser later answered Going on the web, and the browser's responses are claimed
- **THEN** the account has a single response for that event with the answer Going

#### Scenario: Account answer is newer
- **WHEN** the account's existing response was updated after the browser's response
- **THEN** the account keeps its existing answer and the browser's response is removed

#### Scenario: Going account and newer waitlisted browser response
- **WHEN** the account is Going, the browser later answered Going on a full event and was waitlisted, and the browser's responses are claimed
- **THEN** the account stays Going and the waitlisted browser response is removed

#### Scenario: Merge frees spots
- **WHEN** both the account and the browser were Going on a full event with a waitlist and the browser's responses are claimed
- **THEN** one Going response remains and the freed spot goes to the first waitlisted guest who fits

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
