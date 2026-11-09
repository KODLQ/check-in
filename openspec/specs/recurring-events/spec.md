# recurring-events Specification

## Purpose
Lets a group set up an event that repeats (for example the crew's After Work every Friday) once, with each date created automatically as its own event, so recurring plans with the same people take no repeated effort. A series belongs to a group, not to a person.

## Requirements

### Requirement: Create a repeating event
When creating an event with a fixed start time, the owner or an admin of a group SHALL be able to make it repeat every week, every 2 weeks or monthly for that group. The first date SHALL be the entered start time. Repeating SHALL be off by default and SHALL NOT be offered together with a date poll.

#### Scenario: Weekly After Work
- **WHEN** an admin of "AW crew" creates "AW" on Friday 13 Nov 17:00 set to repeat every week for "AW crew"
- **THEN** a series belonging to "AW crew" is created with dates on Fridays 13 Nov, 20 Nov, 27 Nov and 4 Dec at 17:00

#### Scenario: No group yet
- **WHEN** a user who owns or administers no group turns on Repeat
- **THEN** the app asks them to create a group first, in the same flow, and the series belongs to that new group

#### Scenario: Regular member
- **WHEN** a regular member of "AW crew" tries to create a series for it, including by calling the backend directly
- **THEN** the series is not created

#### Scenario: Repeat with a date poll
- **WHEN** a host has chosen to propose candidate times instead of a start time
- **THEN** the repeat option is not available

### Requirement: Monthly repeat by weekday
A monthly series SHALL repeat on the same weekday position as the first date (first to fourth, for example the first Friday). A first date in the last seven days of its month SHALL instead repeat on the last such weekday of each month.

#### Scenario: First Friday
- **WHEN** a monthly series starts on Friday 6 Nov, the first Friday of November
- **THEN** the next date is Friday 4 Dec, the first Friday of December

#### Scenario: Last Thursday
- **WHEN** a monthly series starts on Thursday 26 Nov, the last Thursday of November
- **THEN** the next date is Thursday 31 Dec, the last Thursday of December

### Requirement: Local wall-clock time
Every date of a series SHALL start at the same local time in the series' time zone, also across daylight-saving changes. An end time SHALL keep the same duration.

#### Scenario: Clocks change
- **WHEN** a weekly series at 17:00 Europe/Stockholm has dates on both sides of the end of summer time
- **THEN** every date starts at 17:00 local time

### Requirement: Series belongs to its group
A series SHALL belong to exactly one group and SHALL always invite that group's members to every date. The series SHALL NOT be moved to another group, and its group SHALL NOT be removed from its dates.

#### Scenario: New member sees series dates
- **WHEN** someone joins "AW crew" while its weekly series has four upcoming dates
- **THEN** all four dates appear in their app as invites they have not answered

### Requirement: Group managers manage the series
The group's owner and admins SHALL manage the series and every date of it: edit, cancel a date, change the repeat rule and end the series. They SHALL see each date's full guest list as hosts do. Losing admin rights or leaving the group SHALL end this access immediately.

#### Scenario: Admin edits a date
- **WHEN** an admin of "AW crew" changes the location of the 20 Nov date
- **THEN** the change is saved, as when the host edits an event

#### Scenario: Demoted admin
- **WHEN** an admin who was made a regular member opens a series date
- **THEN** they see it only as a guest and cannot edit it

### Requirement: Group shown as host
The invite page, link preview and app SHALL show a series date as hosted by the group, with the group owner's display name (for example "Hosted by AW crew · Anna").

#### Scenario: Guest opens a series date
- **WHEN** a guest opens the invite link of a date of the "AW crew" series owned by Anna
- **THEN** the page says it is hosted by AW crew and shows Anna's name

### Requirement: Series stays with the group
When a group's ownership passes to someone else, its series and all their dates, past and upcoming, SHALL pass to the new owner. Answers, walls and invite links SHALL be kept.

#### Scenario: Ownership handed over
- **WHEN** Anna hands "AW crew" over to Erik and leaves
- **THEN** the weekly series keeps running, its dates show Erik as owner, and every guest's answer stays

### Requirement: Optional end date
The group's owner or an admin SHALL be able to set an end date for a series. No date SHALL be created after it. Without an end date the series SHALL continue until it is ended.

#### Scenario: Series with an end date
- **WHEN** a weekly series has an end date of 18 Dec
- **THEN** no date after 18 Dec is created

### Requirement: Upcoming dates always available
A series SHALL always have its next four upcoming dates created, unless it has ended or its end date or the 6-month horizon stops it. When a date ends, the next missing date SHALL be created within one hour.

#### Scenario: Date passes
- **WHEN** the Friday 13 Nov date of a weekly series ends
- **THEN** within one hour a date for Friday 11 Dec exists, next to the existing 20 Nov, 27 Nov and 4 Dec dates

### Requirement: Each date is a full event
Each date of a series SHALL be a separate event with its own invite link, RSVPs, plus-ones, capacity, waitlist, announcements and wall, created from the series' current details. Answering one date SHALL NOT answer any other date.

#### Scenario: Going to one date
- **WHEN** a guest answers Going to the 20 Nov date
- **THEN** they have no answer for the 27 Nov date

#### Scenario: Separate invite links
- **WHEN** an admin shares the invite link of the 20 Nov date
- **THEN** that link opens only the 20 Nov date

### Requirement: Guests outside the group
Each date of a series SHALL accept guests who are not group members, through that date's invite link, exactly as for any event. They SHALL NOT need an account or the app, and answering SHALL NOT make them group members. Group managers SHALL be able to share the link with anyone.

#### Scenario: Guest without an account
- **WHEN** an admin of "AW crew" sends the 20 Nov date's link to a colleague who has no account, and the colleague answers Going on the web
- **THEN** the colleague is on that date's guest list as Going, without an account and without joining the group

#### Scenario: Guest is not invited to later dates
- **WHEN** that colleague answered only the 20 Nov date
- **THEN** they are not invited to the 27 Nov date unless someone shares that date's link with them

#### Scenario: Guest list shows who is a member
- **WHEN** an admin opens a date's guest list with both group members and outside guests
- **THEN** outside guests are marked as guests, separately from members

### Requirement: Series shown on dates
The app and the invite page SHALL show on each date that it is part of a series, with the repeat rule in words (for example "Every Friday" or "First Friday of the month"), and SHALL let the guest move to the next date.

#### Scenario: Guest sees the series
- **WHEN** a guest opens the invite page of a weekly date
- **THEN** the page shows "Every Friday" and a link to the next date

### Requirement: Edit this date or all following
When a group owner or admin edits a date of a series, the app SHALL ask whether to change only this date or this and all following dates. A co-host of only that date SHALL only change this date. "All following" SHALL update the series and every upcoming date from this one on. Changes SHALL notify guests who answered, as for any event change.

#### Scenario: Change location for all following
- **WHEN** an admin changes the location of the 20 Nov date and chooses "This and following"
- **THEN** the 20 Nov and 27 Nov dates and all later dates get the new location

#### Scenario: Change only this date
- **WHEN** an admin moves only the 20 Nov date to 18:00
- **THEN** only that date changes and later dates keep 17:00

### Requirement: Change the repeat rule
The group's owner or an admin SHALL be able to change the repeat rule and end date. A new rule SHALL apply to dates created after the change. The app SHALL tell them that dates already planned keep their day.

#### Scenario: Weekly to every 2 weeks
- **WHEN** an admin changes a weekly series to every 2 weeks
- **THEN** existing upcoming dates are kept and the next new date is created 2 weeks after the last existing date

### Requirement: Cancel one date
Cancelling one date SHALL cancel only that event, as for any event, and SHALL NOT affect the series. A cancelled date SHALL count as one of the four upcoming dates until it ends.

#### Scenario: Skip Christmas
- **WHEN** an admin cancels the 25 Dec date of a weekly series
- **THEN** guests of that date are told it is cancelled and the 1 Jan date still happens

### Requirement: End a series
The group's owner or an admin SHALL be able to end a series. Ending SHALL stop new dates from being created. They SHALL choose whether upcoming dates already created are kept or cancelled; cancelled dates SHALL notify their guests. Deleting the group SHALL end its series and cancel their upcoming dates.

#### Scenario: End and cancel upcoming
- **WHEN** an admin ends a series and chooses to cancel upcoming dates
- **THEN** no new dates are created and all upcoming dates are cancelled with notifications to their guests

#### Scenario: End and keep upcoming
- **WHEN** the owner ends a series and keeps upcoming dates
- **THEN** no new dates are created and the upcoming dates already created still happen

#### Scenario: Group deleted
- **WHEN** the owner deletes a group that has a weekly series
- **THEN** the series ends, its upcoming dates are cancelled with notifications to their guests, and past dates are kept

#### Scenario: Member tries to end
- **WHEN** a regular member tries to end the series, including by calling the backend directly
- **THEN** the request is rejected

### Requirement: Series limits
A group SHALL have at most 10 active series. A series' dates SHALL be created no more than 6 months ahead.

#### Scenario: Eleventh series
- **WHEN** a group with 10 active series gets another repeating event
- **THEN** it is not created and the user is told the group reached the limit
