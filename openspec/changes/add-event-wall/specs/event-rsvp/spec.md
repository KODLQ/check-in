# Spec Delta

## MODIFIED Requirements

### Requirement: Change or withdraw RSVP
A guest SHALL be able to change or withdraw their response later from the same browser or device, without signing in. Withdrawing SHALL remove the response but SHALL keep the guest's event wall posts unless the guest also chooses, in the same step, to delete them.

#### Scenario: Guest changes answer
- **WHEN** a guest who answered Maybe opens the invite again on the same device and taps Going
- **THEN** their existing response is updated, not duplicated

#### Scenario: Guest withdraws
- **WHEN** a guest chooses to remove their response
- **THEN** their name and response are deleted from the guest list and counts of the event

#### Scenario: Withdraw keeps wall posts by default
- **WHEN** a guest who has posted on the event wall withdraws without choosing to delete their posts
- **THEN** their posts stay on the wall under their name, they can no longer post, and they can still delete those posts from the same device

#### Scenario: Withdraw and delete wall posts
- **WHEN** a guest withdraws and chooses to also delete their wall posts
- **THEN** their response and all their posts and photos on that event are permanently removed

#### Scenario: Different device
- **WHEN** a guest opens the invite on a device where they have not responded
- **THEN** they are treated as a new guest
