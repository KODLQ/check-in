# Spec Delta

## MODIFIED Requirements

### Requirement: Host guest list
The host and co-hosts SHALL see all responses grouped by Going, Maybe and Can't go, with counts. The list SHALL update live while the host or co-host has it open.

#### Scenario: New response while host is watching
- **WHEN** a guest RSVPs while the host has the guest list open
- **THEN** the guest appears in the right group within a few seconds without a manual refresh

#### Scenario: New response while co-host is watching
- **WHEN** a guest RSVPs while a co-host has the guest list open
- **THEN** the guest appears in the right group within a few seconds without a manual refresh

### Requirement: Guest list visibility
The host or a co-host SHALL choose whether guests can see the guest list. When shown, guests SHALL see display names and responses for Going and Maybe only. Can't go responses SHALL be visible only to the host and co-hosts.

#### Scenario: Guest list hidden
- **WHEN** the host has hidden the guest list and a guest opens the invite
- **THEN** the guest sees only the number of people going, not their names

#### Scenario: Guest list shown
- **WHEN** the host has enabled the guest list
- **THEN** guests see the names of people who answered Going and Maybe, but not Can't go

#### Scenario: Co-host toggles visibility
- **WHEN** a co-host hides the guest list
- **THEN** guests opening the invite see only the number of people going

### Requirement: Remove guest
The host and co-hosts SHALL be able to remove any response from the event.

#### Scenario: Host removes a guest
- **WHEN** the host removes a guest's response
- **THEN** it disappears from the guest list for everyone

#### Scenario: Co-host removes a guest
- **WHEN** a co-host removes a guest's response
- **THEN** it disappears from the guest list for everyone, including the owner
