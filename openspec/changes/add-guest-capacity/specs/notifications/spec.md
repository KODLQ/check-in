# Spec Delta

## MODIFIED Requirements

### Requirement: Host reply digest
The host and each co-host SHALL get a push when guests reply or change their response, batched to at most one push per event per 15 minutes that summarises the new replies. Withdrawals, RSVPs by the host or a co-host, and promotions from the waitlist SHALL NOT trigger it. A guest joining the waitlist SHALL count as a reply.

#### Scenario: Burst of replies
- **WHEN** six guests reply within ten minutes of an invite being shared
- **THEN** the host gets one push for the first reply and one later push summarising the other five

#### Scenario: Digest during quiet hours
- **WHEN** guests reply at 01:00
- **THEN** the host gets a single summary push at 08:00

#### Scenario: Co-host gets the digest
- **WHEN** a guest replies to an event that has a co-host with notifications allowed
- **THEN** the owner and the co-host each get the digest push, and a former co-host does not

#### Scenario: Waitlist promotion
- **WHEN** a Going guest withdraws and a waitlisted guest is promoted automatically
- **THEN** the promotion does not add a reply to the host's digest
