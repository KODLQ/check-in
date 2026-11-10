# Spec Delta

## MODIFIED Requirements

### Requirement: Account deletion
The system SHALL let a signed-in host delete their account. Deleting an account SHALL delete their profile, their events, and all RSVPs to those events. It SHALL also delete every RSVP the account made or claimed on other people's events.

#### Scenario: Host deletes account
- **WHEN** a host confirms account deletion
- **THEN** their profile, events and those events' RSVPs are permanently removed and they are signed out

#### Scenario: Invite link after host deletion
- **WHEN** a guest opens an invite link to an event whose host deleted their account
- **THEN** the page shows that the event no longer exists and reveals no event details

#### Scenario: Claimed responses removed with account
- **WHEN** a user who claimed web responses deletes their account
- **THEN** those responses are removed from the hosts' guest lists
