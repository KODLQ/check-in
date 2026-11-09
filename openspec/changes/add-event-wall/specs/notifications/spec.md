# Spec Delta

## ADDED Requirements

### Requirement: Host wall digest
The host and each co-host SHALL get a push when guests post on an event wall, batched to at most one push per event per 15 minutes that says how many new posts there are. Posts by the host or a co-host SHALL NOT trigger it, and no push SHALL contain post text, photos or poster names.

#### Scenario: Burst of posts
- **WHEN** five guests post photos within ten minutes after the party
- **THEN** the host gets one push for the first post and one later push saying there are four new posts

#### Scenario: Co-host posts
- **WHEN** a co-host posts on the wall
- **THEN** no wall push is sent for that post
