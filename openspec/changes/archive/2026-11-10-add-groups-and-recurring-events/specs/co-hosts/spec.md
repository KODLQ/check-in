# Spec Delta

## MODIFIED Requirements

### Requirement: Owner-only actions
Only the owner SHALL be able to cancel the event, delete the event, create or revoke co-host invite links, and remove co-hosts. These actions SHALL be rejected server-side for co-hosts and SHALL NOT be offered to them in the app. For a date of a group's series, the group's admins SHALL have the same rights as the owner, except deleting the date.

#### Scenario: Co-host tries to cancel
- **WHEN** a co-host attempts to cancel the event, including by calling the backend directly
- **THEN** the request is rejected and the event stays active

#### Scenario: Co-host tries to delete
- **WHEN** a co-host attempts to delete the event
- **THEN** the event is not deleted

#### Scenario: Co-host tries to remove another co-host
- **WHEN** a co-host attempts to remove another co-host
- **THEN** the request is rejected and the other co-host keeps access

#### Scenario: Group admin cancels a series date
- **WHEN** an admin of "AW crew" cancels the 25 Dec date of the group's weekly series
- **THEN** the date is cancelled as if the owner had done it

#### Scenario: Group admin tries to delete a series date
- **WHEN** an admin of "AW crew" tries to delete a date of the group's series, including by calling the backend directly
- **THEN** the date is not deleted
