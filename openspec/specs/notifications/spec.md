# notifications Specification

## Purpose
Delivers timely, respectful push and email notifications about private events to app users and to guests who opted in, so that nobody misses a change, cancellation or reply, while keeping personal data to a minimum.

## Requirements

### Requirement: Push to app users
The system SHALL deliver notifications to signed-in app users as push notifications on every device where they are signed in and have allowed notifications. Signed-in users SHALL NOT receive notification emails.

#### Scenario: User with two devices
- **WHEN** a notification is sent to a signed-in user who allowed notifications on a phone and a tablet
- **THEN** both devices receive the push

#### Scenario: Notifications not allowed
- **WHEN** a notification is sent to a signed-in user who has not allowed notifications on any device
- **THEN** no push is sent and no email is sent instead

### Requirement: Push permission timing
The app SHALL ask for notification permission only after the user creates their first event or RSVPs to an event in the app, and SHALL NOT ask on first launch or sign-in.

#### Scenario: First launch
- **WHEN** a person installs the app and signs in
- **THEN** they are not asked for notification permission

#### Scenario: Host creates first event
- **WHEN** a host finishes creating their first event
- **THEN** the app explains why notifications help and then shows the system permission prompt

#### Scenario: Permission declined
- **WHEN** a user declines the system permission prompt
- **THEN** the app keeps working and does not show the system prompt again on its own

### Requirement: Push registration lifecycle
A device SHALL receive push for an account only while that account is signed in on it. Signing out SHALL stop push to that device, and a device the push service reports as no longer registered SHALL stop receiving sends.

#### Scenario: Sign out
- **WHEN** a user signs out on a device
- **THEN** that device receives no further notifications for that account

#### Scenario: Account switch on the same device
- **WHEN** a different user signs in on a device after the previous user signed out
- **THEN** the device receives notifications only for the user now signed in

#### Scenario: Account deleted
- **WHEN** a user deletes their account
- **THEN** all of their device registrations and pending notifications are deleted

### Requirement: Email only with consent
The system SHALL send notification emails about an event only to guests who gave an email and ticked the consent for that specific event, and SHALL use the address only for notifications about that event.

#### Scenario: Guest without email
- **WHEN** an event notification is sent and a Going guest RSVPed on the web without an email
- **THEN** that guest receives nothing and the other recipients are unaffected

#### Scenario: Same email, other event
- **WHEN** a guest opted in for event A and later RSVPs to event B without opting in
- **THEN** they receive emails about event A only

### Requirement: Subscription confirmation email
When a guest opts in to email updates, the system SHALL send one confirmation email naming the event and the host, stating that the host cannot see the address, and including the unsubscribe link.

#### Scenario: Guest opts in
- **WHEN** a guest RSVPs with an email and the consent ticked
- **THEN** they receive a confirmation email for that event within a few minutes

#### Scenario: Opt-in repeated
- **WHEN** a guest who is already subscribed changes their response on the same device
- **THEN** no new confirmation email is sent

### Requirement: Guest email confidentiality
A guest's email address SHALL NOT be shown or returned to the host, to co-hosts, to other guests, or in any invite page, link preview, guest list or export other than to the guest's own device.

#### Scenario: Host views guest list
- **WHEN** the host opens the guest list of an event where guests opted in to email
- **THEN** no email addresses are shown or returned, only names and responses

#### Scenario: Guest sees own subscription
- **WHEN** a subscribed guest reopens the invite on the same device
- **THEN** they see that email updates are on, with their address partly masked

### Requirement: Guest email retention
The system SHALL keep a guest's email only while it is needed: it SHALL be deleted when the RSVP is deleted, when the guest unsubscribes, when the address hard-bounces or reports spam, and no later than 2 days after the event ended or was cancelled.

#### Scenario: Guest withdraws
- **WHEN** a subscribed guest withdraws their RSVP or the host removes it
- **THEN** the email address and consent record are deleted with it

#### Scenario: Event over
- **WHEN** 2 days have passed since a subscribed guest's event ended
- **THEN** the email address is deleted even though the RSVP remains

#### Scenario: Hard bounce
- **WHEN** the email provider reports a hard bounce or spam complaint for a guest address
- **THEN** the address is deleted and no further emails are attempted

### Requirement: One-click unsubscribe
Every notification email SHALL contain an unsubscribe link and a one-click unsubscribe header. Unsubscribing SHALL take one confirmation click, need no sign-in, stop emails about that event, and delete the address.

#### Scenario: Unsubscribe from email
- **WHEN** a guest opens the unsubscribe link from an email and confirms
- **THEN** they see that they are unsubscribed, receive no more emails about that event, and their RSVP is kept

#### Scenario: Mail client one-click
- **WHEN** a mail client sends a one-click unsubscribe request for a notification email
- **THEN** the guest is unsubscribed without opening a page

#### Scenario: Link scanner
- **WHEN** a security scanner merely fetches the unsubscribe link without confirming
- **THEN** the guest stays subscribed

#### Scenario: Unknown or used link
- **WHEN** someone opens an unsubscribe link whose subscription no longer exists
- **THEN** a page says they will not receive further emails, without revealing any event details

### Requirement: Recipient language
Each notification SHALL be written in Swedish or English using the recipient's language: the device language for push and the invite-page language at opt-in for email, defaulting to English. Times SHALL be shown in the event's time zone.

#### Scenario: Swedish guest
- **WHEN** a guest who opted in from a Swedish-language invite page is notified
- **THEN** the email subject and body are in Swedish with times in Europe/Stockholm

### Requirement: Quiet hours
Non-urgent notifications SHALL NOT be delivered between 22:00 and 08:00 Europe/Stockholm time and SHALL be delivered at 08:00 instead. Cancellations and changes to an event starting within 12 hours SHALL be urgent and delivered immediately.

#### Scenario: Announcement late at night
- **WHEN** a host posts an announcement at 23:30
- **THEN** guests receive it at 08:00 the next morning

#### Scenario: Cancellation late at night
- **WHEN** a host cancels an event at 23:30
- **THEN** guests are notified immediately

#### Scenario: Stale deferred notification
- **WHEN** a deferred notification's event was cancelled or has started by the time it would be sent
- **THEN** it is not sent

### Requirement: Recipients decided at send time
The recipients of an event notification SHALL be decided when it is sent, so that people who withdrew, changed to Can't go, unsubscribed or were removed after it was created do not receive it.

#### Scenario: Guest changes to Can't go before send
- **WHEN** a guest changes from Going to Can't go while an announcement to Going and Maybe guests is waiting for quiet hours to end
- **THEN** that guest does not receive the announcement

### Requirement: Delivery at most once with retries
Each notification SHALL reach each recipient channel at most once, even if delivery is retried or the sender restarts. Temporary delivery failures SHALL be retried with increasing delays for up to 24 hours before giving up.

#### Scenario: Provider temporarily down
- **WHEN** the email or push provider fails with a temporary error
- **THEN** the send is retried later and the recipient gets the notification exactly once when the provider recovers

#### Scenario: Worker crash after sending
- **WHEN** the sender stops after the provider accepted a message but before recording success
- **THEN** the retry does not produce a second copy for the recipient

### Requirement: Per-recipient rate limits
The system SHALL limit notifications per recipient to at most 10 emails per guest subscription per day and 20 pushes per user per hour. Non-urgent notifications over the limit SHALL be postponed or dropped if stale; urgent ones SHALL always be sent.

#### Scenario: Many announcements
- **WHEN** a recipient has reached their limit and another non-urgent notification is due
- **THEN** it is postponed until the limit allows it, and dropped if its event has started by then

#### Scenario: Opt-in abuse
- **WHEN** the same email address is opted in to more than 5 events within 24 hours
- **THEN** further opt-ins for that address are refused that day, the RSVPs themselves are still saved, and the guest is told email updates could not be turned on

### Requirement: Notification opens the event
Tapping a push SHALL open the related event in the app, and every email SHALL link to the event's current invite page.

#### Scenario: Tap push
- **WHEN** a user taps a notification about an event
- **THEN** the app opens that event's screen (host view for the host, invite view for a guest)

#### Scenario: Link regenerated after send
- **WHEN** the host regenerates the invite link and a later email is sent
- **THEN** the email links to the new, working invite link

### Requirement: Event change notification
When the host changes the start time, end time or location of an upcoming event, Going and Maybe guests SHALL be notified with the new details. Several edits within 5 minutes SHALL produce one notification with the latest details.

#### Scenario: Time moved
- **WHEN** the host moves an event from 19:00 to 20:00
- **THEN** Going and Maybe guests are notified of the new time and Can't go guests are not

#### Scenario: Quick successive edits
- **WHEN** the host changes the location twice within two minutes
- **THEN** guests receive one notification showing the final location

#### Scenario: Other fields edited
- **WHEN** the host only edits the description or cover
- **THEN** no notification is sent

### Requirement: Cancellation notification
When the host cancels an event, Going and Maybe guests SHALL be notified immediately, and pending notifications about that event SHALL NOT be sent afterwards.

#### Scenario: Event cancelled
- **WHEN** the host cancels an event with Going and Maybe guests
- **THEN** those guests are notified that it is cancelled, and a pending reminder for it is not sent

### Requirement: Event reminder
Going and Maybe guests SHALL get one reminder about 24 hours before start. For events created less than 24 hours before start, the reminder SHALL be sent at 08:00 on the event day if that is still before start; otherwise none is sent.

#### Scenario: Normal reminder
- **WHEN** an event starts on Saturday at 20:00 and was created on Tuesday
- **THEN** Going and Maybe guests get a reminder on Friday at about 20:00

#### Scenario: Late-created event
- **WHEN** an event starting at 19:00 today was created at 07:00 today
- **THEN** guests who are Going or Maybe at 08:00 get the reminder at 08:00

#### Scenario: Time changed after reminder scheduled
- **WHEN** the host moves the start time
- **THEN** the reminder is rescheduled for the new start time and guests still get only one reminder per start time

### Requirement: Host reply digest
The host SHALL get a push when guests reply or change their response, batched to at most one push per event per 15 minutes that summarises the new replies. Withdrawals and the host's own RSVP SHALL NOT trigger it.

#### Scenario: Burst of replies
- **WHEN** six guests reply within ten minutes of an invite being shared
- **THEN** the host gets one push for the first reply and one later push summarising the other five

#### Scenario: Digest during quiet hours
- **WHEN** guests reply at 01:00
- **THEN** the host gets a single summary push at 08:00
