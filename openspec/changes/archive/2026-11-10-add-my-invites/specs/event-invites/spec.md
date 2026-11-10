# Spec Delta

## ADDED Requirements

### Requirement: Plan-your-own prompt after RSVP
After a guest has responded on the invite page, the page SHALL show a non-blocking "Plan your own in 30 seconds →" prompt in the page language (Swedish or English). Before a response, the page SHALL NOT show it in a way that competes with the RSVP options.

#### Scenario: Prompt after responding
- **WHEN** a guest taps Going on the invite page
- **THEN** their answer is shown and, below it, a "Plan your own in 30 seconds →" prompt appears without covering the event details or RSVP options

#### Scenario: Prompt in Swedish
- **WHEN** a guest with Swedish as the preferred language has responded
- **THEN** the prompt is shown in Swedish

#### Scenario: Ignoring the prompt
- **WHEN** a guest ignores the prompt
- **THEN** they can still change or withdraw their response and use every other part of the page

### Requirement: Hand-off from invite page to the app
Following the prompt SHALL lead to a page that links to the app stores and offers to open the app with a claim code for that browser's responses. The browser's guest token and the claim code SHALL NOT appear in any URL path, query string or Referer header sent to a server.

#### Scenario: App not installed
- **WHEN** a guest follows the prompt on a phone without the app
- **THEN** they see links to the App Store and Google Play, and an "Open the app" button that works once the app is installed

#### Scenario: App installed
- **WHEN** a guest with the app installed taps "Open the app" on the hand-off page
- **THEN** the app opens, asks them to sign in if needed, and then adds their web responses to their invites

#### Scenario: Secret stays out of server logs
- **WHEN** the hand-off page is loaded or any link on it is followed
- **THEN** no request to the web or API servers carries the claim code or guest token in its URL or Referer
