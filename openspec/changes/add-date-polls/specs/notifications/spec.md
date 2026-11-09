# Spec Delta

## ADDED Requirements

### Requirement: Notifications around a date pick
Picking the date of a date-pending event SHALL NOT send an event change notification, and the RSVPs it creates SHALL NOT count as replies in the host reply digest. The picked start time SHALL get an event reminder under the normal reminder rules, as if the event had been created with that time at the moment of the pick.

#### Scenario: Pick is not a time change
- **WHEN** the host picks the date of a date-pending event with Yes voters
- **THEN** no "event changed" notification and no reply digest is sent for the converted RSVPs

#### Scenario: Reminder after a pick
- **WHEN** the host picks an option starting in three days
- **THEN** guests who are Going or Maybe get one reminder about 24 hours before that start
