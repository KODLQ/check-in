# Spec Delta

## MODIFIED Requirements

### Requirement: Account deletion
The system SHALL let a signed-in host delete their account. Deleting an account SHALL delete their profile, the events they own, and all RSVPs to those events, for everyone including those events' co-hosts. It SHALL also delete every RSVP the account made or claimed on other people's events. For events the person only co-hosts, it SHALL remove only their co-host membership; those events and their RSVPs SHALL remain.

#### Scenario: Host deletes account
- **WHEN** a host confirms account deletion
- **THEN** their profile, events and those events' RSVPs are permanently removed and they are signed out

#### Scenario: Invite link after host deletion
- **WHEN** a guest opens an invite link to an event whose host deleted their account
- **THEN** the page shows that the event no longer exists and reveals no event details

#### Scenario: Claimed responses removed with account
- **WHEN** a user who claimed web responses deletes their account
- **THEN** those responses are removed from the hosts' guest lists

#### Scenario: Co-host deletes account
- **WHEN** a person who co-hosts Anna's event deletes their account
- **THEN** they are no longer a co-host, Anna's event, its RSVPs and its cover stay intact, and guests no longer see their name as a host

#### Scenario: Owner with co-hosts deletes account
- **WHEN** the owner of an event that has co-hosts deletes their account
- **THEN** the event and its RSVPs are deleted and the event disappears from the co-hosts' event lists

## ADDED Requirements

### Requirement: Groups on account deletion
Deleting an account SHALL delete its group memberships and invitations. Each group it owns, with the group's series and their dates, SHALL pass to its longest-standing admin, or else its longest-standing member. A group with no other member SHALL be deleted with its series and their dates.

#### Scenario: Group owner deletes account
- **WHEN** the owner of "AW crew", which has admin Erik and other members, deletes their account
- **THEN** Erik becomes the owner of "AW crew" and every other member stays

#### Scenario: Sole member deletes account
- **WHEN** a user who is the only member of a group they own deletes their account
- **THEN** that group, its series and their dates are deleted

#### Scenario: Group with a series passes on
- **WHEN** the owner of "AW crew", which has a weekly series, deletes their account and Sara is the longest-standing member and there are no admins
- **THEN** Sara owns "AW crew" and its series, and the series' dates and answers stay

#### Scenario: Group member deletes account
- **WHEN** a member of Anna's group deletes their account
- **THEN** they are removed from the group and Anna's group stays intact
