# event-wall Specification

## Purpose
Gives every private event a shared wall where the host and attending guests post short messages before the event and photos after it, visible only to people with the invite link and fully under the host's moderation.

## Requirements

### Requirement: Wall visible to invite-link holders
Each event SHALL have a wall shown on the web invite page and in the app. Anyone who can open the event's active invite link SHALL be able to read the wall without signing in. Wall content SHALL NOT be returned for unknown or revoked links, and SHALL NOT appear in link previews.

#### Scenario: Guest without RSVP reads the wall
- **WHEN** a person who has not responded opens an active invite link
- **THEN** they see the wall's posts and photos below the event details

#### Scenario: Revoked link
- **WHEN** someone opens an invite link that the host has revoked
- **THEN** the generic "invite not found" page is shown and no wall content or photo is returned

#### Scenario: Link preview
- **WHEN** a link preview is generated for an invite link
- **THEN** it contains no wall text, photos or poster names

### Requirement: Who can post
The host and co-hosts SHALL be able to post on their event's wall. A guest SHALL be able to post only while their current response on that event is Going or Maybe. Everyone else, including people who answered Can't go, waitlisted guests, people who only voted in a date poll and people who have not responded, SHALL be able to read but not post.

#### Scenario: Going guest posts
- **WHEN** a guest whose response is Going submits a post
- **THEN** the post is saved and appears at the top of the wall

#### Scenario: Can't-go guest tries to post
- **WHEN** a guest whose response is Can't go submits a post
- **THEN** the post is rejected and they are told that only people who are going or might go can post

#### Scenario: Visitor without RSVP
- **WHEN** a visitor without a response views the wall
- **THEN** no post form is shown and they are invited to RSVP first

#### Scenario: Waitlisted guest
- **WHEN** a guest who is on the waitlist submits a post
- **THEN** the post is rejected, and they can post once they are promoted to Going

#### Scenario: Date poll voter
- **WHEN** a guest who has only voted in the date poll of a date-pending event views the wall
- **THEN** no post form is shown, while the host and co-hosts can already post

### Requirement: Posting identity
A post SHALL be attributed to the same identity the poster RSVPed with: the device guest token on the web or the signed-in account in the app. The wall SHALL show each post's poster display name and time, and mark posts by the host or a co-host as a host's.

#### Scenario: Web guest posts
- **WHEN** a web guest who RSVPed as "Sara" on this device posts
- **THEN** the post shows "Sara" and is recognised as hers on later visits from the same device

#### Scenario: Host post marked
- **WHEN** the host or a co-host posts on the wall
- **THEN** the post shows their display name with a host label

### Requirement: Post content
A post SHALL contain text of at most 500 characters, one to four photos, or both. Empty posts SHALL be rejected. Text SHALL be displayed as plain text: no markup is rendered and links are not clickable.

#### Scenario: Text too long
- **WHEN** a guest submits text longer than 500 characters
- **THEN** the post is rejected and the limit is shown

#### Scenario: Empty post
- **WHEN** a guest submits a post with only whitespace and no photos
- **THEN** the post is rejected

#### Scenario: Markup in text
- **WHEN** a post's text contains HTML or a URL
- **THEN** it is shown literally as text, with no rendered markup and no clickable link

### Requirement: Posting window
Posting SHALL be open from event creation until 14 days after the event has ended; an event whose date is still pending has not ended. After that, and for cancelled events, the wall SHALL be read-only, while still allowing posters to delete their own posts and the host and co-hosts to moderate.

#### Scenario: Photos after the party
- **WHEN** a Going guest posts photos two days after the event ended
- **THEN** the post is accepted

#### Scenario: Window closed
- **WHEN** a guest tries to post 15 days after the event ended
- **THEN** the post is rejected and the wall is shown as read-only

#### Scenario: Cancelled event
- **WHEN** a guest opens the invite link of a cancelled event
- **THEN** the cancelled notice is shown together with the existing wall, with no post form

### Requirement: Photo formats and size
The system SHALL accept photos in JPEG, PNG, WebP or HEIC format of at most 10 MB each, judged by the file's actual content rather than its name or declared type. Animated images SHALL be reduced to their first frame.

#### Scenario: Too large
- **WHEN** a guest tries to upload a 12 MB photo
- **THEN** the upload is rejected with a message stating the 10 MB limit

#### Scenario: Disguised file
- **WHEN** a file named photo.jpg that is not a valid image in an accepted format is uploaded
- **THEN** it is rejected and never appears on the wall

### Requirement: Photo quota per guest
Each guest SHALL be able to have at most 10 photos on a given event's wall at any time. Deleting a photo's post SHALL free its quota. The host and co-hosts SHALL NOT be limited by this quota.

#### Scenario: Eleventh photo
- **WHEN** a guest who already has 10 photos on the wall tries to add another
- **THEN** the upload is rejected and they are told they have reached the limit

### Requirement: Photo metadata removal
Every photo SHALL be re-processed by the server before it becomes visible, removing all embedded metadata including EXIF, GPS position, camera details and comments, regardless of what the uploading client did. The original uploaded file SHALL never be served to anyone.

#### Scenario: Photo with GPS data
- **WHEN** a guest uploads a photo containing GPS coordinates in its EXIF data
- **THEN** the photo shown on the wall contains no GPS or other EXIF metadata

#### Scenario: Unprocessed upload
- **WHEN** an upload has been stored but not yet processed
- **THEN** it is not visible on the wall and cannot be fetched by any guest or host

### Requirement: Private photo delivery
Wall photos SHALL NOT be publicly addressable. They SHALL be served only through links that expire within one hour and are issued only to someone who passed an active-invite-link, host or co-host check.

#### Scenario: Old photo link
- **WHEN** someone opens a wall photo link more than one hour after it was issued
- **THEN** the photo is not returned

#### Scenario: Link revoked
- **WHEN** the host regenerates the invite link
- **THEN** photo links can no longer be obtained through the old invite link

### Requirement: Safe photo upload from the web
Web visitors SHALL upload photos only through a single-use upload permission that the server issues after verifying the invite link, the visitor's eligibility to post, their remaining photo quota and rate limits. Upload permissions SHALL expire, and unused or rejected uploads SHALL be deleted within 24 hours.

#### Scenario: Upload without permission
- **WHEN** a client tries to upload a wall photo without a valid upload permission
- **THEN** the upload is rejected

#### Scenario: Abandoned upload
- **WHEN** a guest uploads a photo but never completes the post
- **THEN** the uploaded file is deleted within 24 hours and never shown

### Requirement: Delete own post
A poster SHALL be able to delete any of their own posts at any time, from the same device (web) or account (app) they posted with, including after the event ended, after it was cancelled and after withdrawing their RSVP. Deletion SHALL remove the text and photos permanently.

#### Scenario: Guest deletes a post
- **WHEN** a guest deletes one of their posts
- **THEN** the post and its photos disappear from the wall for everyone and the photos can no longer be fetched

#### Scenario: Someone else's post
- **WHEN** a guest tries to delete a post made by another guest
- **THEN** the deletion is rejected

### Requirement: Delete all own posts
A poster SHALL be able to delete all of their posts on an event in one action.

#### Scenario: Remove everything I posted
- **WHEN** a guest chooses "Delete all my posts" and confirms
- **THEN** every post and photo they made on that event is permanently removed

### Requirement: Host deletes posts
The host and co-hosts SHALL be able to delete any post on the event's wall, and SHALL be able to delete all posts by a given poster in one action.

#### Scenario: Host removes an inappropriate post
- **WHEN** the host deletes a guest's post
- **THEN** it disappears from the wall for everyone and its photos can no longer be fetched

#### Scenario: Co-host moderates
- **WHEN** a co-host deletes a guest's post
- **THEN** it disappears from the wall for everyone, including the owner

### Requirement: Wall on or off
The host and co-hosts SHALL be able to turn the wall on or off for each event at any time, including after it ended or was cancelled. New events SHALL use the host's default setting, which is on unless the host changed it. While the wall is off, guests SHALL NOT see it or post; existing posts SHALL be kept and reappear when it is turned back on.

#### Scenario: Host turns the wall off
- **WHEN** the host turns off the wall of an event
- **THEN** guests opening the invite see no wall and cannot post, and the host and co-hosts still see the existing posts in the app

#### Scenario: Default off
- **WHEN** a host whose default is "wall off" creates an event
- **THEN** the new event's wall is off

### Requirement: Stop a guest from posting
The host and co-hosts SHALL be able to stop a specific poster from posting on the event and later allow them again. Their existing posts SHALL remain unless deleted. Removing a guest's response SHALL NOT by itself delete their posts.

#### Scenario: Blocked guest tries to post
- **WHEN** a guest the host has stopped from posting submits a post
- **THEN** the post is rejected, while the guest can still read the wall and delete their own posts

### Requirement: Wall rate limits
The system SHALL limit how many posts and photo uploads a single client and a single poster can make on an event in a short period, and SHALL cap the total number of posts and photos per event, rejecting excess with a "try again later" or "wall is full" message.

#### Scenario: Flood of posts
- **WHEN** a single client submits posts faster than the allowed rate
- **THEN** further posts are rejected with a "try again later" message

#### Scenario: Wall full
- **WHEN** a post would exceed the event's total post or photo cap
- **THEN** it is rejected with a message that the wall is full

### Requirement: Live wall for hosts
While the host or a co-host has the wall open in the app, new and deleted posts SHALL appear or disappear within a few seconds without a manual refresh.

#### Scenario: Guest posts while host is watching
- **WHEN** a guest posts while the host has the wall open in the app
- **THEN** the post appears in the host's wall within a few seconds

### Requirement: Web wall refresh
The web invite page SHALL show the visitor's own new post or deletion immediately after it succeeds, together with any other posts made since the page was loaded. It SHALL NOT require a live connection.

#### Scenario: Guest posts on the web
- **WHEN** a web guest submits a post successfully
- **THEN** the wall reloads and shows their post at the top along with posts others made in the meantime

### Requirement: Wall retention
Wall posts and photos SHALL be deleted when their event is deleted, including the automatic deletion 12 months after the event ends. Photo files SHALL be removed from storage within 24 hours of their post or event being deleted.

#### Scenario: Event deleted
- **WHEN** the host deletes an event
- **THEN** all its wall posts are removed immediately and its photo files are removed from storage within 24 hours
