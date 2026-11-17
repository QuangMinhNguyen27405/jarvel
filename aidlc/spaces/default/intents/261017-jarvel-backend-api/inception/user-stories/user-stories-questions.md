# User Stories Plan and Questions

## Story Plan

- **Personas:** drawn from the approved requirements (`inception/requirements-analysis/requirements.md`). It names two kinds of user: invited travelers and you as the only admin (FR1). Q1 settles the set.
- **Story format:** "As a [persona], I want [goal], so that [benefit]", following INVEST (independent, negotiable, valuable, estimable, small, testable). Each story gets an ID like `US1.1`, and its acceptance criteria are Given/When/Then with IDs like `AC1.1.1`.
- **Prioritization:** MoSCoW, taken from the requirements: FR1 to FR9 and the NFRs are Must, FR10 to FR15 are Should. Delivery Planning sets the final first-release boundary.
- **Breakdown:** chosen in Q2.
- **Granularity:** chosen in Q3.

## Q1. Which personas should the stories be written for?

A. Two: the invited traveler and you as admin (recommended; matches FR1)
B. Three: the invited traveler, a travel companion who only reads a shared plan (should-have FR14), and you as admin
X. Other (please specify)

[Answer]: A

## Q2. How should the stories be grouped?

A. By the traveler's journey (sign in, ask for a plan, wait for it, read it, delete it), with admin stories in their own group (recommended)
B. By requirement area, one group per FR group (access, requests, plan, safety, transit, limit, reading, deletion, data)
C. By persona only
X. Other (please specify)

[Answer]: A

## Q3. How small should each story be?

A. Small: one behaviour per story with 3 to 6 acceptance criteria, about 25 to 30 stories in all (recommended)
B. Larger: about 10 to 12 stories, each with more acceptance criteria
X. Other (please specify)

[Answer]: A

## Q4. Should the should-have requirements (FR10 to FR15) get stories now?

A. Yes, write them and mark them Should, so they are ready if time remains (recommended)
B. No, write stories for the must-haves only
X. Other (please specify)

[Answer]: A

## Q5. Should the stories mark what the Nov 1 first plan needs?
The review of the requirements noted that no requirement says which must-haves the Nov 1 milestone (your own first Boston plan) needs.

A. Yes: tag the stories for sign-in, asking for a plan, hourly safety, transit and reading the plan (JSON and Markdown) as the Nov 1 slice. The monthly limit, deletion and retention follow by Nov 18 (recommended)
B. No, leave it entirely to Delivery Planning
X. Other (please specify)

[Answer]: A

## Q6. Does a plan that fails because it cannot be made safe count against the 3-a-month limit?
The requirements give the count back only for failures on our side (FR6.1). A plan can also fail because no safe schedule or no last-train-safe route exists (FR4.3, FR5.3). The review raised this as open.

A. No, give the count back: the traveler did nothing wrong (recommended)
B. Yes, it counts like any other accepted request
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Personas: two, the invited traveler and you as the only admin [Q1]
- Grouping: by the traveler's journey (sign in, ask for a plan, wait, read, delete), with admin stories in their own group [Q2]
- Size: small stories, one behaviour each, 3 to 6 acceptance criteria, about 25 to 30 stories [Q3]
- Should-haves: stories written now for FR10 to FR15, marked Should [Q4]
- Nov 1 slice: stories for sign-in, asking for a plan, hourly safety, transit and reading the plan (JSON and Markdown) are tagged Nov 1; the monthly limit, deletion and retention follow by Nov 18 [Q5]
- A plan that fails because no safe schedule or last-train-safe route exists gives its monthly count back [Q6]

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
