# Spec Delta

## MODIFIED Requirements

### Requirement: Change or withdraw RSVP
A guest SHALL be able to change or withdraw their response later from the same browser or device, without signing in. This SHALL remain possible after the response has been claimed by an account.

#### Scenario: Guest changes answer
- **WHEN** a guest who answered Maybe opens the invite again on the same device and taps Going
- **THEN** their existing response is updated, not duplicated

#### Scenario: Guest withdraws
- **WHEN** a guest chooses to remove their response
- **THEN** their name and response are deleted from the event

#### Scenario: Different device
- **WHEN** a guest opens the invite on a device where they have not responded
- **THEN** they are treated as a new guest

#### Scenario: Same browser after claiming
- **WHEN** a guest whose web response was claimed into their account opens the invite again in the same browser and taps Can't go
- **THEN** the claimed response is updated, the account still holds it, and no duplicate response is created

## ADDED Requirements

### Requirement: Claim web RSVPs into an account
A signed-in app user SHALL be able to claim the responses made from a browser. To do so they redeem a claim code that only that browser can create. Claiming SHALL link every response that browser made to the account, including responses to ended and cancelled events. Responses SHALL NOT be claimable by display name or any other guessable detail.

#### Scenario: Guest installs the app and signs in
- **WHEN** a guest who answered two invites on the web uses the hand-off from that browser and then signs in to the app
- **THEN** both responses are linked to their account and appear in their invites list

#### Scenario: Claim attempted by name
- **WHEN** someone tries to claim responses using only a guest's display name or an event link
- **THEN** no responses are linked

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
