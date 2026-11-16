# Requirements Analysis Questions

Context: the approved scope (`ideation/scope-definition/scope-document.md`) is a Boston-only, invite-only backend API by Nov 18, 2026. It has five must-haves: a day-by-day plan (S-01), hourly safety (S-02), public transport first, aware of the last train (S-03), invite-only access (S-04) and at most 3 plans per person per month (S-05). The code scan found that only the shared types exist. Ideation left two questions open for this stage (who sends invitations, how deletion works), plus the web app question raised on Oct 21. The rest are facts about your world that the requirements need in order to be testable.

## Q1. Who sends invitations, and how does an invited person get in?
Invite-only access (S-04) is a must-have, and Ideation left the "who and how" open.

A. You, as the only admin, add a person by email; the system emails them a temporary password and they set their own on first sign-in. Nobody else can create an account (recommended)
B. You hand out single-use invite codes; a person signs up with a code
C. You keep an allowlist of email addresses; a person on the list can sign up themselves
D. Any invited person can invite others
X. Other (please specify)

[Answer]: A

## Q2. How does an invited person get their data deleted?
Privacy rules mean people must be able to get their data deleted (C-12), but "seeing and deleting my past plans" (S-09) is only a should-have.

A. Two must-haves: a person can delete one of their own plans through the API, and you can delete a whole account and everything in it on request (recommended)
B. Only you delete data, on request, as a documented manual admin step; no delete endpoint for travelers
C. Data is deleted automatically after a retention period, and nothing else
X. Other (please specify)

[Answer]: A

## Q3. How long are plans kept?

A. 90 days after the trip's departure date, then deleted automatically (recommended)
B. 30 days after the trip's departure date
C. Until the person or you delete them
X. Other (please specify)

[Answer]: A

## Q4. With no traveler web app, how does a traveler read their plan?
The API returns the plan as structured data (JSON). For the Nov 1 milestone you need to read your own plan comfortably.

A. The API returns JSON and also a readable Markdown version of the same plan (recommended)
B. JSON only; a tool such as curl or Postman is enough for this version
C. The finished plan is also emailed to the traveler
X. Other (please specify)

[Answer]: A

## Q5. The traveler web app (raised Oct 21): where does it go?
The approved scope leaves it out of this version (C-16).

A. Keep it out of this version and plan it as separate work after Nov 18 (recommended)
B. Add a minimal web app to this version (this takes hours from the must-haves)
X. Other (please specify)

[Answer]: A

## Q6. What counts against the 3-plans-a-month limit?

A. Every accepted plan request counts except plans that fail on our side; the month is the calendar month in Boston time and resets on the 1st (recommended)
B. Every accepted plan request counts, failed or not
C. A rolling 30 days instead of the calendar month
X. Other (please specify)

[Answer]: A

## Q7. What are the limits on one trip request?
Longer trips and bigger groups cost more AI time and must still return in under 5 minutes (C-09).

A. 1 to 7 days, 1 to 6 travelers, arrival in the future and no more than 12 months ahead, up to 15 wishlist places (recommended)
B. 1 to 14 days, 1 to 10 travelers, up to 25 wishlist places
X. Other (please specify)

[Answer]: A

## Q8. How is the hand-checked Boston information (places, safety areas, transit) updated?
You prepare it by hand (approval-handoff Q3).

A. It lives as versioned data files in the repository and changes with a deploy; no admin API (recommended)
B. You change it through an admin-only API without redeploying
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Invitations: you, the only admin, add people by email; they get a temporary password and set their own at first sign-in; nobody else can create an account [Q1]
- Deletion: a person can delete one of their own plans through the API, and you can delete a whole account and all its data on request; both are must-haves [Q2]
- Retention: plans are deleted automatically 90 days after the trip's departure date [Q3]
- Reading a plan: the API returns JSON and also a readable Markdown version of the same plan [Q4]
- Web app: stays out of this version; planned as separate work after Nov 18 [Q5]
- Monthly limit: every accepted plan request counts except plans that fail on our side; calendar month in Boston time, resetting on the 1st [Q6]
- Trip limits: 1 to 7 days, 1 to 6 travelers, arrival in the future and at most 12 months ahead, up to 15 wishlist places [Q7]
- Boston data: versioned data files in the repository, changed with a deploy; no admin API [Q8]

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
