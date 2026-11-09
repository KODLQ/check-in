# Spec Delta

## MODIFIED Requirements

### Requirement: Change or withdraw RSVP
A guest SHALL be able to change or withdraw their response, including their number of plus-ones, later from the same browser or device, without signing in. This SHALL remain possible from the same browser after the response has been claimed by an account. A change or withdrawal that frees spots SHALL let waitlisted guests be promoted. Withdrawing SHALL keep the guest's event wall posts unless they also choose, in the same step, to delete them.

#### Scenario: Guest changes answer
- **WHEN** a guest who answered Maybe opens the invite again on the same device and taps Going
- **THEN** their existing response is updated, not duplicated

#### Scenario: Guest withdraws
- **WHEN** a guest chooses to remove their response
- **THEN** their name and response are deleted from the event, together with any email they gave for updates

#### Scenario: Withdraw keeps wall posts by default
- **WHEN** a guest who has posted on the event wall withdraws without choosing to delete their posts
- **THEN** their posts stay on the wall under their name, they can no longer post, and they can still delete those posts from the same device

#### Scenario: Withdraw and delete wall posts
- **WHEN** a guest withdraws and chooses to also delete their wall posts
- **THEN** their response and all their posts and photos on that event are permanently removed

#### Scenario: Different device
- **WHEN** a guest opens the invite on a device where they have not responded
- **THEN** they are treated as a new guest

#### Scenario: Same browser after claiming
- **WHEN** a guest whose web response was claimed into their account opens the invite again in the same browser and taps Can't go
- **THEN** the claimed response is updated, the account still holds it, and no duplicate response is created

#### Scenario: Going guest lowers plus-ones
- **WHEN** a Going guest on a full event with a waitlist changes from +2 to +0
- **THEN** their response stays Going +0 and the 2 freed spots go to waitlisted guests

#### Scenario: Going guest adds plus-ones beyond capacity
- **WHEN** a Going guest asks for more plus-ones than there are spots left
- **THEN** the change is rejected, they keep their current Going answer, and they are told how many spots are left
