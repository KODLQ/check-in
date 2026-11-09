# Spec Delta

## ADDED Requirements

### Requirement: Wall content removed with account
Deleting an account SHALL also delete every event wall post and photo the account made, on any event, including posts made from a browser whose responses were claimed into the account. Wall posts and photos on events the account owns SHALL be deleted with those events. Posts the person made as a co-host on events they did not own SHALL be deleted too.

#### Scenario: Wall posts on other events
- **WHEN** a person who posted on another host's event wall from the app deletes their account
- **THEN** those posts and their photos are removed from that wall

#### Scenario: Claimed web posts
- **WHEN** a guest posted on a wall from the browser, later claimed that browser's responses into their account, and then deletes the account
- **THEN** the posts made from the browser are removed too

#### Scenario: Host deletes account
- **WHEN** a host with wall posts on their events deletes their account
- **THEN** every post and photo on those events' walls is removed together with the events
