# Spec Delta

## Purpose

Lets the person who created an event (the owner) share its management with up to five co-hosts, with a clear split between what co-hosts can do and what stays with the owner.

## ADDED Requirements

### Requirement: Co-host invite link
The owner SHALL be able to create a co-host invite link for an upcoming, non-cancelled event. Each link SHALL contain a random token of at least 128 bits of entropy, SHALL be usable by exactly one person, and SHALL expire 7 days after it was created. Co-host invite links SHALL be distinct from the guest invite link and SHALL NOT work as one.

#### Scenario: Owner creates a co-host link
- **WHEN** the owner taps "Invite co-host" on their upcoming event
- **THEN** a new co-host invite link is created and the share sheet opens with it

#### Scenario: Co-host link is not a guest link
- **WHEN** someone opens a co-host invite link's token as a guest invite link
- **THEN** the generic "invite not found" page is shown

#### Scenario: Co-host cannot create co-host links
- **WHEN** a co-host attempts to create a co-host invite link
- **THEN** the request is rejected and no link is created

### Requirement: Co-host limit
An event SHALL have at most 5 co-hosts, not counting the owner. The owner SHALL NOT be able to create a co-host invite link while the number of co-hosts plus unused, unexpired, unrevoked co-host links is 5 or more.

#### Scenario: Limit reached when inviting
- **WHEN** an event has 4 co-hosts and 1 pending co-host link and the owner tries to create another link
- **THEN** no link is created and the owner is told the event already has the maximum number of co-hosts

#### Scenario: Limit reached when accepting
- **WHEN** a person accepts a valid co-host link for an event that already has 5 co-hosts
- **THEN** they do not become a co-host and are told the event already has the maximum number of co-hosts

### Requirement: Accept co-host invite in the app
Accepting a co-host invite SHALL require being signed in to the app with a display name. Before accepting, the person SHALL see the event title, the owner's name and that their display name will be shown to guests as a host. Accepting SHALL make them a co-host and use up the link.

#### Scenario: Signed-in user accepts
- **WHEN** a signed-in user opens a valid co-host link in the app and taps Accept
- **THEN** they become a co-host, the link can no longer be used, and the event opens with co-host controls

#### Scenario: Signed-out user opens link
- **WHEN** a person who is not signed in opens a valid co-host link in the app
- **THEN** they are asked to sign in and, after signing in, return to the accept screen for that link

#### Scenario: Link opened in a browser
- **WHEN** a co-host link is opened in a browser
- **THEN** the page offers to open or install the app, shows no event location, guest list or other event details beyond the title and owner's name, and offers no way to accept on the web

#### Scenario: Owner opens their own link
- **WHEN** the event's owner opens one of their own co-host links
- **THEN** they are told they already host the event and the link stays unused

#### Scenario: Existing co-host opens a link
- **WHEN** a user who is already a co-host of the event opens another co-host link for it
- **THEN** the event opens and the link stays unused

### Requirement: Invalid co-host invite
A co-host invite link that is unknown, expired, revoked, already used, or belongs to a cancelled, ended or deleted event SHALL show the same generic "invite no longer valid" message and reveal no event details.

#### Scenario: Expired link
- **WHEN** a signed-in user opens a co-host link more than 7 days after it was created
- **THEN** they see "invite no longer valid" and do not become a co-host

#### Scenario: Already used link
- **WHEN** a second person opens a co-host link that someone already accepted
- **THEN** they see "invite no longer valid" and do not become a co-host

### Requirement: Revoke co-host invite
The owner SHALL see the event's pending co-host links and SHALL be able to revoke any of them. A revoked link SHALL stop working immediately.

#### Scenario: Owner revokes a pending link
- **WHEN** the owner revokes a pending co-host link
- **THEN** opening that link shows "invite no longer valid" and it no longer counts toward the co-host limit

### Requirement: Co-host permissions
A co-host SHALL be able to edit event details and cover, share the guest invite link, regenerate the guest invite link, see the full live guest list including Can't go, remove guests, and toggle guest-list visibility, with the same rules that apply to the owner.

#### Scenario: Co-host edits the event
- **WHEN** a co-host changes the location of an upcoming event
- **THEN** the change is saved and guests see the new location on the invite page

#### Scenario: Co-host regenerates the guest link
- **WHEN** a co-host regenerates the guest invite link
- **THEN** the old link stops working, the new link works for everyone managing the event, and existing RSVPs are kept

### Requirement: Owner-only actions
Only the owner SHALL be able to cancel the event, delete the event, create or revoke co-host invite links, and remove co-hosts. These actions SHALL be rejected server-side for co-hosts and SHALL NOT be offered to them in the app.

#### Scenario: Co-host tries to cancel
- **WHEN** a co-host attempts to cancel the event, including by calling the backend directly
- **THEN** the request is rejected and the event stays active

#### Scenario: Co-host tries to delete
- **WHEN** a co-host attempts to delete the event
- **THEN** the event is not deleted

#### Scenario: Co-host tries to remove another co-host
- **WHEN** a co-host attempts to remove another co-host
- **THEN** the request is rejected and the other co-host keeps access

### Requirement: Leave as co-host
A co-host SHALL be able to leave an event at any time. Leaving SHALL immediately remove their access, including live guest-list updates, and remove their name from the event's host names.

#### Scenario: Co-host leaves
- **WHEN** a co-host confirms "Leave as co-host"
- **THEN** the event disappears from their event list, they stop receiving its guest-list updates, and guests no longer see their name as a host

### Requirement: Remove co-host
The owner SHALL be able to remove any co-host. Removal SHALL take effect immediately, including for a co-host who has the event open.

#### Scenario: Owner removes a co-host who is watching
- **WHEN** the owner removes a co-host while that co-host has the guest list open
- **THEN** the co-host stops receiving guest-list updates, cannot load or change the event, and is told they are no longer a co-host

### Requirement: Co-host list
The owner and co-hosts SHALL see the event's owner and co-hosts by display name. Guests and other users SHALL NOT be able to list an event's co-hosts except as host names on the invite page.

#### Scenario: Co-host views hosts
- **WHEN** a co-host opens the event in the app
- **THEN** they see the owner marked as owner and every co-host's display name

### Requirement: Host names shown to guests
Wherever the invite page or link preview shows who hosts an event, it SHALL list the owner first and then co-hosts in the order they joined, joined naturally for the UI language (e.g. "Hosted by Anna & Erik", "Hosted by Anna, Erik & Sara").

#### Scenario: Event with one co-host
- **WHEN** a guest opens the invite of an event owned by Anna with co-host Erik
- **THEN** the page and the link preview say the event is hosted by Anna & Erik

#### Scenario: Event without co-hosts
- **WHEN** a guest opens the invite of an event with no co-hosts
- **THEN** only the owner's name is shown, as before

### Requirement: No access for guests and non-members
Co-host membership SHALL grant access only to the co-host themself. Guests, signed-in users who are not owner or co-host, and former co-hosts SHALL NOT be able to read or change the event, its guest list, its guest invite links, its co-host links or its co-host list, other than what the guest invite page already shows.

#### Scenario: Former co-host queries the event
- **WHEN** a removed co-host requests the event, its RSVPs or its invite link directly from the backend
- **THEN** no rows are returned

#### Scenario: Guest with invite link
- **WHEN** a guest who has the guest invite link tries to read the event's co-host links
- **THEN** nothing is returned
