# Spec Delta

## MODIFIED Requirements

### Requirement: Account deletion
The system SHALL let a signed-in host delete their account. Deleting an account SHALL delete their profile, the events they own, and all RSVPs to those events, for everyone including those events' co-hosts. For events the person only co-hosts, it SHALL remove only their co-host membership; those events and their RSVPs SHALL remain.

#### Scenario: Host deletes account
- **WHEN** a host confirms account deletion
- **THEN** their profile, events and those events' RSVPs are permanently removed and they are signed out

#### Scenario: Invite link after host deletion
- **WHEN** a guest opens an invite link to an event whose host deleted their account
- **THEN** the page shows that the event no longer exists and reveals no event details

#### Scenario: Co-host deletes account
- **WHEN** a person who co-hosts Anna's event deletes their account
- **THEN** they are no longer a co-host, Anna's event, its RSVPs and its cover stay intact, and guests no longer see their name as a host

#### Scenario: Owner with co-hosts deletes account
- **WHEN** the owner of an event that has co-hosts deletes their account
- **THEN** the event and its RSVPs are deleted and the event disappears from the co-hosts' event lists
