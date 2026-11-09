# Spec Delta

## Purpose

Lets a host keep a named group of the people they usually invite (for example an After Work crew), so a whole group can be invited to an event or a recurring series in one step, with every member having agreed to join.

## ADDED Requirements

### Requirement: Create a group
A signed-in user SHALL be able to create a group with a name of 1 to 50 characters. The creator SHALL be the group's owner. The owner SHALL be shown as a member of their own group and SHALL only leave it by handing over ownership.

#### Scenario: Group created
- **WHEN** a signed-in user creates a group named "AW crew"
- **THEN** the group exists with that user as owner and only member

#### Scenario: Name missing or too long
- **WHEN** a user tries to create a group with an empty name or a name longer than 50 characters
- **THEN** the group is not created and the name field is indicated

### Requirement: Group limits
A user SHALL own at most 20 groups. A group SHALL have at most 50 members including the owner. Pending invitations SHALL count towards the member limit.

#### Scenario: Twenty-first group
- **WHEN** a user who owns 20 groups tries to create another
- **THEN** the group is not created and the user is told they reached the limit

#### Scenario: Full group
- **WHEN** a group has 50 members and pending invitations combined and someone tries to join or is invited
- **THEN** the join or invitation is rejected with a message that the group is full

### Requirement: Group admins
The owner and admins SHALL be able to make any regular member an admin. Only the owner SHALL be able to make an admin a regular member again. The owner SHALL always have every admin right and SHALL NOT be demoted. Regular members SHALL NOT have admin rights.

#### Scenario: Owner appoints an admin
- **WHEN** the owner makes Erik an admin of "AW crew"
- **THEN** Erik can share the group link, invite past guests, remove regular members and invite the group to their own events

#### Scenario: Admin appoints another admin
- **WHEN** admin Erik makes Sara an admin
- **THEN** Sara gets admin rights

#### Scenario: Owner demotes an admin
- **WHEN** the owner makes admin Sara a regular member
- **THEN** Sara loses admin rights and stays in the group

#### Scenario: Admin tries to demote another admin
- **WHEN** admin Erik tries to make admin Sara a regular member, including by calling the backend directly
- **THEN** the request is rejected and Sara stays an admin

#### Scenario: Admin tries to demote the owner
- **WHEN** an admin tries to remove the owner's rights or remove the owner, including by calling the backend directly
- **THEN** the request is rejected

#### Scenario: Regular member tries an admin action
- **WHEN** a regular member tries to remove another member, including by calling the backend directly
- **THEN** the request is rejected

### Requirement: Rename a group
The owner and admins SHALL be able to rename a group, with the same name rules as when creating it.

#### Scenario: Admin renames
- **WHEN** an admin renames "AW crew" to "Friday crew"
- **THEN** all members see the new name

#### Scenario: Member tries to rename
- **WHEN** a regular member tries to rename the group, including by calling the backend directly
- **THEN** the request is rejected

### Requirement: Delete a group
Only the owner SHALL be able to delete a group. Deleting a group SHALL remove its memberships, invitations and links, SHALL stop inviting it to one-off events, and SHALL end its series. Past events and RSVPs SHALL be kept.

#### Scenario: Owner deletes a group
- **WHEN** the owner deletes a group that a one-off party invites and that has a weekly series
- **THEN** the group is gone, the party stays without the group, the series ends with its upcoming dates cancelled, and past RSVPs stay

#### Scenario: Admin tries to delete
- **WHEN** an admin tries to delete the group, including by calling the backend directly
- **THEN** the request is rejected and the group stays

### Requirement: Group invite link
The owner and admins SHALL be able to create a group invite link with an unguessable token, and to revoke it, which immediately makes it stop working and allows creating a new one. A group SHALL have at most one active link.

#### Scenario: Link created
- **WHEN** the owner taps "Invite with link" on a group without an active link
- **THEN** a link is created and the share sheet opens with it

#### Scenario: Link revoked
- **WHEN** the owner revokes the group link and someone opens the old link
- **THEN** they see the same invalid-link message as for a link that never existed

### Requirement: Join with the group link
Joining a group SHALL require being signed in to the app. Opening a valid group link SHALL show the group name, the owner's display name and the number of members, and a Join button. Joining SHALL add the user as a member immediately. A user without the app SHALL be offered to get the app.

#### Scenario: Signed-in user joins
- **WHEN** a signed-in user opens a valid group link and taps Join
- **THEN** they become a member and see the group's upcoming events

#### Scenario: Link opened on the web
- **WHEN** someone opens a group link in a browser
- **THEN** the page shows the group name, owner and member count and offers to open or get the app, and does not let them join from the web

#### Scenario: Already a member
- **WHEN** a member opens the group's link again
- **THEN** they are taken to the group without creating a second membership

### Requirement: Invite past guests
The owner and admins SHALL be able to invite people to a group from the guests of events they themselves own or co-host. Only guests whose answer is linked to an app account SHALL be listed. An invited person SHALL become a member only after accepting.

#### Scenario: Picking past guests
- **WHEN** an admin opens "Add from past guests"
- **THEN** they see the account-linked guests of their own and co-hosted events, without people who are already members or have a pending invitation

#### Scenario: Web-only guests not offered
- **WHEN** a guest answered only from the web without an account
- **THEN** that guest is not listed for invitation

### Requirement: Accept or decline a group invitation
An invited user SHALL see the invitation in the app with the group name and owner, and SHALL be able to accept or decline it. Accepting SHALL add them as a member. Declining SHALL remove the invitation without telling the owner or admins who declined. Invitations SHALL expire after 30 days.

#### Scenario: Invitation accepted
- **WHEN** an invited user taps Accept
- **THEN** they become a member and the invitation disappears

#### Scenario: Invitation declined
- **WHEN** an invited user taps Decline
- **THEN** the invitation disappears and they are not a member

#### Scenario: Re-invite after decline
- **WHEN** the owner or an admin invites someone who declined less than 30 days ago
- **THEN** no new invitation is sent and they see the same result as for a successful invite

### Requirement: Member list visibility
Members SHALL see the group name, the owner and every member's display name, with the owner and admins marked. People who are not members SHALL NOT see a group's members, and a group link SHALL reveal only the name, owner name and member count.

#### Scenario: Member views the group
- **WHEN** a member opens the group
- **THEN** they see all members' display names with the owner and admins marked

#### Scenario: Non-member queries a group
- **WHEN** a signed-in user who is not a member requests a group's members, including by calling the backend directly
- **THEN** nothing is returned, the same as for a group that does not exist

### Requirement: Leave or remove members
A member or admin SHALL be able to leave a group at any time. The owner SHALL be able to remove any member or admin. Admins SHALL be able to remove regular members only. A person who leaves or is removed SHALL stop receiving the group's event invitations; their existing answers SHALL be kept.

#### Scenario: Member leaves
- **WHEN** a member leaves a group whose series has an upcoming date they have not answered
- **THEN** they stop being a member and that date disappears from their list

#### Scenario: Admin tries to remove another admin
- **WHEN** admin Erik tries to remove admin Sara from the group, including by calling the backend directly
- **THEN** the request is rejected and Sara stays in the group

#### Scenario: Answered date kept after leaving
- **WHEN** a member who answered Going to an upcoming group date leaves the group
- **THEN** their Going answer stays and the date stays in their list

### Requirement: Owner leaves by handing over ownership
An owner who leaves a group SHALL first pick a new owner among the other members. The app SHALL suggest the longest-standing admin, or the longest-standing member if there is no admin. The new owner SHALL get all owner rights, including the group's series, and the previous owner SHALL leave the group. An owner who is the only member SHALL only be able to delete the group.

#### Scenario: Owner hands over and leaves
- **WHEN** Anna leaves "AW crew" and picks admin Erik as new owner
- **THEN** Erik is the owner, the group's series now show Erik as owner, Anna is no longer a member, and all other members and admins stay

#### Scenario: Suggested new owner
- **WHEN** the owner of a group with admins Erik (joined first) and Sara taps Leave
- **THEN** Erik is suggested as the new owner

#### Scenario: Leaving without picking
- **WHEN** an owner tries to leave without picking a new owner, including by calling the backend directly
- **THEN** the request is rejected and they stay owner

#### Scenario: Only member
- **WHEN** the owner is the group's only member and taps Leave
- **THEN** the app offers only to delete the group

#### Scenario: New owner at the group limit
- **WHEN** an owner picks a member who already owns 20 groups
- **THEN** the handover is rejected and the owner is asked to pick someone else

### Requirement: Groups list in the app
The app SHALL show the user the groups they own or belong to, and any pending group invitations, with the member count of each group.

#### Scenario: User opens groups
- **WHEN** a user who owns one group and belongs to another opens their groups
- **THEN** both groups are listed with member counts, the owned one marked as theirs

### Requirement: Group abuse limits
Creating groups, invitations and joins SHALL be rate limited per user. Group invitations sent by one user SHALL be limited to 100 per 24 hours.

#### Scenario: Invitation flood
- **WHEN** an admin sends a 101st group invitation within 24 hours
- **THEN** the invitation is rejected with a rate-limit message
