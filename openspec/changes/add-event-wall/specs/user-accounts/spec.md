# Spec Delta

## MODIFIED Requirements

### Requirement: Account deletion
The system SHALL let a signed-in host delete their account. Deleting an account SHALL delete their profile, their events, and all RSVPs to those events, together with all wall posts and photos on those events and every wall post and photo the account made on other hosts' events.

#### Scenario: Host deletes account
- **WHEN** a host confirms account deletion
- **THEN** their profile, events and those events' RSVPs are permanently removed and they are signed out

#### Scenario: Invite link after host deletion
- **WHEN** a guest opens an invite link to an event whose host deleted their account
- **THEN** the page shows that the event no longer exists and reveals no event details

#### Scenario: Wall posts on other events
- **WHEN** a person who posted on another host's event wall from the app deletes their account
- **THEN** those posts and their photos are removed from that wall
