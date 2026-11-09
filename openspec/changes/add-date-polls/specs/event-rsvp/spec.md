# Spec Delta

## MODIFIED Requirements

### Requirement: RSVP closed for inactive events
RSVPs SHALL NOT be accepted for events that are cancelled, have already ended, or whose date is still pending. A date-pending event SHALL never be treated as ended.

#### Scenario: Event has ended
- **WHEN** a guest opens the invite after the event's end (or 12 hours after start when no end time is set)
- **THEN** the page shows the event as past and offers no RSVP options

#### Scenario: Date still pending
- **WHEN** a guest or signed-in user tries to RSVP to an event whose date has not been picked
- **THEN** the RSVP is rejected and the invite shows the date poll instead of RSVP options

#### Scenario: Date picked
- **WHEN** the host picks a date for a date-pending event
- **THEN** RSVPs are accepted from then on under the normal rules, including plus-ones, capacity and the waitlist
