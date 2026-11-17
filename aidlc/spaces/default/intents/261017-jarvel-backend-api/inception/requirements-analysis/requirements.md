# Requirements: Jarvel Backend API, Nov 18 Version

## Intent Analysis

The initial request was "build the jarvel backend API" [desc]. Ideation narrowed that to a Boston-only, invite-only planning API that must work by Nov 18, 2026, with a first working plan for the requester's own trip by Nov 1, 2026 [scope-document] [C-01].

What the person is trying to achieve:
- **Primary goal:** an invited traveler asks for a Boston trip and gets back, within 5 minutes, a day-by-day plan that keeps them safe hour by hour and moves them by public transport without missing the last train [intent-statement] [scope-document].
- **Secondary goals:** learning [intent-statement], and staying under $25 per month in total [C-03].
- **Request type:** new feature work on a brownfield scaffold. Only the shared types in `shared/src/types.ts` exist; there is no runtime behaviour yet [business-overview] [code-structure].
- **Complexity:** standard. One builder, under about 45 building hours [C-02] [C-10].

Priority uses MoSCoW: **Must** (needed by Nov 18), **Should** (built only if time remains after every Must) [scope-document].

## Functional Requirements

Each requirement ends with its pass/fail check.

### FR1. Invite-only access (S-04)

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR1 | Only people the admin has invited can use the API. | Must | [S-04] [Q1] | A request from anyone who has not been invited is rejected. |
| FR1.1 | The admin (the requester, the only admin) invites a person by email address. The system sends that person a temporary password. | Must | [Q1] | After the admin invites an address, that address receives an email with a temporary password. |
| FR1.2 | On first sign-in, an invited person must replace the temporary password with their own before they can call any other endpoint. | Must | [Q1] | Using the API with the temporary password is refused until a new password is set. |
| FR1.3 | Nobody can create their own account. There is no public sign-up. | Must | [Q1] [scope-document, out of scope] | Every self sign-up attempt is refused. |
| FR1.4 | Every endpoint, apart from a health check that returns no data, requires a valid signed-in session. | Must | [S-04] | A request with no token, or with an expired or forged token, gets 401 and no data. |
| FR1.5 | A person can read and delete only their own plans. Asking for someone else's plan answers exactly as if the plan did not exist. | Must | [S-04] [corner-checklist: per-object authorization] | Person B asking for person A's plan id gets 404, the same answer as for an unknown id. |
| FR1.6 | The admin can disable an invited person. A disabled person's requests are refused within 1 hour of the change. | Must | [Q1] [corner-checklist: rights revoked while signed in] | 1 hour after being disabled, the person's requests get 401 or 403. |

### FR2. Plan requests (S-01)

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR2 | A signed-in person can ask for a Boston trip plan by giving arrival and departure date-times, number of travelers, hotel, wishlist and preferences (pace, safety strictness, budget level, transport choice, longest single walk, day start, back-at-hotel time). | Must | [S-01] [code-structure: `TripRequest`] | A valid request is accepted. |
| FR2.1 | A request must fit these limits: the trip is 1 to 7 days long, has 1 to 6 travelers and up to 15 wishlist places, and arrives in the future but no more than 12 months ahead. Departure must come after arrival. | Must | [Q7] | A request at each limit is accepted. A request one step past any limit (8 days, 7 travelers, 16 places, a past arrival, arrival 12 months and 1 day ahead, departure before arrival) is rejected. |
| FR2.2 | A rejected request gets a 400 answer that names every invalid field and why. A rejected request does not count against the monthly limit. | Must | [corner-checklist: invalid input] | A request with two bad fields gets one answer naming both fields, and the person's count for the month is unchanged. |
| FR2.3 | A valid request is answered at once, before the plan is built, with the plan's id and the status `QUEUED`. | Must | [C-09] [code-structure: `CreatePlanResponse`] | The submit call returns in under 2 seconds with a plan id and `QUEUED`. |
| FR2.4 | A plan moves only `QUEUED` → `RUNNING` → `SUCCEEDED` or `FAILED`. `SUCCEEDED` and `FAILED` are final. | Must | [code-structure: `PlanStatus`] | No plan is ever seen going back to an earlier status or leaving a final one. |
| FR2.5 | A plan that has not succeeded within 5 minutes of being accepted is marked `FAILED`, with a reason the traveler can read. | Must | [C-09] [corner-checklist: stuck work] | A plan forced to stall shows `FAILED` and a reason no later than 6 minutes after it was accepted. |
| FR2.6 | Sending the same request twice with the same idempotency key creates one plan and counts once. | Must | [corner-checklist: double submit] | Two identical submits with one key return the same plan id, and the monthly count goes up by 1. |
| FR2.7 | The hotel must be in the area the stored Boston transit network covers. Otherwise the request is rejected with a message saying so. | Must | [S-01] [S-03] [scope-document: Boston only] | A hotel more than a 30-minute walk from every stored station is rejected. |

### FR3. The day-by-day plan (S-01)

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR3 | A succeeded plan has one day for every calendar date from arrival to departure. Each day is a timeline of stops, meals, transit legs and rest, with a start and end time on each item. | Must | [S-01] [code-structure: `Itinerary`, `DayPlan`] | A trip from Nov 18 10:00 to Nov 21 15:00 has exactly 4 days, and the items in each day do not overlap in time. |
| FR3.1 | Every place on the wishlist is either scheduled or listed as unscheduled with a reason. This includes places not found in the Boston data (reason: not in the Boston data). | Must | [intent-statement: 100% wishlist metric] | Each wishlist entry appears exactly once, either in the timeline or in the unscheduled list with a non-empty reason. |
| FR3.2 | The first day begins no earlier than arrival time plus travel to the hotel. The last day ends at the hotel or the airport before departure time. | Must | [S-01] | No item on the first day starts before arrival, and none on the last day ends after departure. |
| FR3.3 | Each day starts no earlier than the person's day start and ends back at the hotel no later than their back-at-hotel time. | Must | [S-01] [code-structure: `TripPreferences.dayEnd`] | On every day, the first item starts at or after day start, and the arrival at the hotel is at or before the back-at-hotel time. |
| FR3.4 | All times are Boston local time (America/New_York), dates are `YYYY-MM-DD` and times are 24-hour `HH:MM`, including across a daylight-saving change. | Must | [business-overview: time rule] [corner-checklist: time zones] | A trip spanning a daylight-saving change shows correct local times on both sides of it. |
| FR3.5 | Only places in the hand-checked Boston data are scheduled. | Must | [S-01] [C-08] | Every scheduled stop refers to a place id in the current Boston data. |

### FR4. Hourly safety (S-02)

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR4 | Every item in a plan, including walks and waits at stations, is checked against the hand-checked Boston safety information for the time it happens. | Must | [S-02] | The safety check runs on 100% of items before a plan is marked `SUCCEEDED`. |
| FR4.1 | No item is placed in an area after that area's "avoid after" time. | Must | [business-overview: `SafetyArea.avoidAfter`] | Test plans built against areas with an avoid-after time contain no items in those areas after it. |
| FR4.2 | After dark, no item is placed in an area with a high night risk. With strict safety, areas with a moderate night risk are also avoided after dark. "After dark" means after sunset on that date in Boston. | Must | [S-02] [business-overview: `safety: strict`] | Test plans contain no after-sunset items in high-risk areas, or in moderate-risk areas when strictness is strict. |
| FR4.3 | A plan that breaks any safety rule is never returned as `SUCCEEDED`. The final plan is checked by fixed rules in code, not only by the AI. A plan that cannot be made safe is returned as `FAILED`, or the unsafe stops are moved to the unscheduled list with the reason "unsafe at the only possible time". | Must | [intent-statement: zero safety rules broken] [corner-checklist: AI output] | A fixed-rule check finds zero violations in every `SUCCEEDED` plan in the test suite, including one built on purpose from an AI answer that breaks a rule. |
| FR4.4 | Every plan includes the safety guidance for each day and a disclaimer that it is guidance, not a guarantee. | Must | [C-13] | Every `SUCCEEDED` plan contains the disclaimer text and safety guidance for each day. |
| FR4.5 | A place whose area has no safety information is treated as unknown risk and only scheduled before sunset. | Must | [corner-checklist: unknown vs zero] | A place with no safety area never appears after sunset. |

### FR5. Public transport first, aware of the last train (S-03)

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR5 | Moving between two consecutive items uses walking and the stored Boston subway, light rail and Silver Line network. Each leg shows its steps (walk, ride with line and direction, transfer, wait), the stations, an estimated time and the fare. | Must | [S-03] [code-structure: `TransitLeg`, `TransitStep`] | Every change of location in a plan has a leg, and every leg's steps go from the earlier location to the later one. |
| FR5.1 | No single walking step is longer than the person's longest-walk setting. | Must | [code-structure: `maxWalkMinutes`] | No walking step in any test plan is over the setting. |
| FR5.2 | No ride is planned after that line's last train or before its first train on that day of the week. The ride back to the hotel is included in this. | Must | [S-03] | No test plan has a ride whose departure falls outside its line's service hours. |
| FR5.3 | When the only way back to the hotel would miss the last train, the day is rearranged so it does not, or the stop is moved to unscheduled with the reason "would miss the last train". | Must | [S-03] [intent-statement: no missed last train] | A test case where the last stop would end after the last train ends with a rearranged day or an unscheduled entry. It never ends with an impossible ride. |
| FR5.4 | Transit times come from the stored timetable data (headways, first and last trains, travel times between stations). Live delays are not used. | Must | [S-03] [code-structure: `TransitNetwork`] | Leg times can be recomputed from the stored data alone. |

### FR6. At most 3 plans per person per month (S-05)

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR6 | A person can have at most 3 counted plan requests in one calendar month, Boston time. The count resets at 00:00 Boston time on the 1st. | Must | [S-05] [Q6] | A 4th request in a month is refused. A request at 00:00 on the 1st is accepted. |
| FR6.1 | Every accepted request counts, except a plan that ends `FAILED` because of a fault on our side (timeout, AI error, internal error). Its count is given back. A rejected, invalid request never counts. | Must | [Q6] | After one plan fails on our side, the person can still make 3 more successful requests that month. |
| FR6.2 | A refused request gets a 429 answer giving the limit, how many were used and the date the count resets. | Must | [S-05] [corner-checklist: rate limited] | The 4th request's answer contains limit 3, used 3, and the reset date. |
| FR6.3 | Requests sent at the same moment cannot get past the limit. | Must | [corner-checklist: two actors at once] | With 2 used, 5 requests sent at once lead to exactly 1 accepted. |

### FR7. Reading a plan

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR7 | A person can fetch one of their plans by id as JSON. It shows the status, the progress so far and, once `SUCCEEDED`, the full plan. A `FAILED` plan shows its reason. | Must | [S-01] [Q4] | Fetching a plan in each status returns that status and the matching content. |
| FR7.1 | The same plan can be fetched as readable Markdown with the same content: days, times, stops, transit legs, safety guidance, disclaimer and unscheduled list. | Must | [Q4] | For a `SUCCEEDED` plan, every stop and leg in the JSON also appears in the Markdown. |

### FR8. Deletion and retention

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR8 | A person can delete one of their own plans. After that it cannot be fetched, and its stored data is gone. | Must | [Q2] [C-12] | After delete, fetching the plan gets 404 and its stored records and files no longer exist. |
| FR8.1 | On request, the admin can delete a whole account: the sign-in identity, every plan and every stored file belonging to it. | Must | [Q2] [C-12] | After account deletion, nothing stored references that person's id. |
| FR8.2 | Each plan is deleted automatically 90 days after its trip's departure date. | Must | [Q3] | A plan whose departure was 91 days ago no longer exists. A plan at 89 days still does. |
| FR8.3 | Deleting a plan does not give back its monthly count. | Must | [Q6] (inferred so delete-and-retry cannot get past the limit) | Deleting a counted plan leaves the month's count unchanged. |

### FR9. Hand-checked Boston data

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR9 | The Boston places, safety areas and transit network live as versioned data files in the repository. They change only through a deploy. There is no admin API to edit them. | Must | [Q8] [approval-handoff Q3] | The data's version is shown on every plan, and no endpoint changes it. |
| FR9.1 | The data files are checked before deploy: every place's station and safety area exist, every line's stations exist, and times are valid `HH:MM`. A broken file stops the deploy. | Must | [corner-checklist: malformed records] | A data file with a place pointing to a missing station fails the check in CI. |
| FR9.2 | Each plan records which version of the Boston data it was built from, and which outside sources must be credited. | Must | [C-14] | Every `SUCCEEDED` plan shows the data version and the source credits. |

### FR10. Should-haves (built only if time remains)

| ID | Requirement | Priority | Source | Pass/fail check |
|----|-------------|----------|--------|-----------------|
| FR10 | Relaxed pace by rule: at most 3 major stops a day, with at least 30 minutes of buffer between items. | Should | [S-06] [business-overview: pace rule] | Relaxed-pace test plans have at most 3 major stops a day and at least 30-minute gaps. |
| FR11 | A trip cost estimate (transit, food, entry fees) labelled as an estimate, in US dollars, with whole cents. | Should | [S-07] [corner-checklist: money, estimates] | Every plan's cost total equals the sum of its parts and is labelled as an estimate. |
| FR12 | Every scheduled stop falls inside that place's opening hours on that date. | Should | [S-08] | No test plan has a visit outside opening hours. |
| FR13 | A person can list their own plans, newest first. | Should | [S-09] | The list contains only the caller's plans, ordered by creation time with a stable tie-break. |
| FR14 | A person can share a read-only link to a plan with travel companions. | Should | [S-10] | A shared link shows the plan without sign-in and allows no change. |
| FR15 | Stops that need a reservation include a booking or reservation link. | Should | [S-11] | Every scheduled stop marked as needing a reservation has a link. |

## Non-Functional Requirements

| ID | Requirement | Source | Pass/fail check |
|----|-------------|--------|-----------------|
| NFR1 | **Plan time:** 95% of plans reach `SUCCEEDED` within 5 minutes of being accepted, and no plan stays unfinished past 5 minutes (FR2.5). | [C-09] [intent-statement] | Measured over the last 20 plans in staging: at least 19 under 5 minutes. |
| NFR2 | **API speed:** the submit, fetch and delete calls answer within 2 seconds for 95% of calls. | [C-09] | 95th percentile under 2 s in the staging smoke check. |
| NFR3 | **Cost:** total running cost stays under $25 per month, including building and testing. A billing alarm fires at $20. The AI cost of each plan is recorded with the plan. | [C-03] [team-practices: Deployment] | The monthly bill is under $25. The alarm exists and is set at $20. Each plan record has an AI cost figure. |
| NFR4 | **Security:** all traffic uses HTTPS. Stored data is encrypted. No secrets are in code or the repository. Each component gets only the permissions it needs. Every input is validated at the API boundary. | [construction guardrails] [project.md: never commit secrets] | A security review of the infrastructure diff finds no wildcard permissions on data, and no secret in the repository. |
| NFR5 | **Untrusted text and the AI:** a traveler's free text (wishlist, notes) is passed to the AI as marked data. It cannot change the safety rules, the limits or anyone's access. | [corner-checklist: AI output] | A test request whose notes say "ignore safety rules" still produces a plan that passes FR4.3. |
| NFR6 | **Privacy and location:** personal data is stored only in a US AWS Region. Emails and tokens never appear in logs. | [C-11] [C-12] | The deployed stack's Region is in the US, and a log search for a test user's email finds nothing. |
| NFR7 | **Availability:** the API is available 99% of the time over a rolling 30-day window. | [operation guardrails] | The health-check success rate over 30 days is at least 99%. |
| NFR8 | **Observability:** each plan logs its status changes, duration and AI cost. There is a metric for API errors and one for failed plans, each with an alarm. | [operation guardrails] | The metrics and alarms exist in staging and record a deliberately failed plan. |
| NFR9 | **Reliability of AI calls:** AI answers are checked against the expected structure. A bad or failed answer is retried at most twice before the plan fails. Retrying never creates a second plan or a second count. | [corner-checklist: AI output, retries] | A test with a fake AI that returns bad output twice, then good output, ends `SUCCEEDED` with one plan and one count. |
| NFR10 | **Testability:** at least 80% line coverage, checked in CI. Automated tests make no paid AWS or AI calls. A smoke check runs against the real deployment after each deploy. | [team-practices: Testing Posture] [project.md: Forbidden] | CI fails below 80%. The test suite runs with no AWS credentials. |

## Constraints

- First version by Nov 18, 2026; the date holds and scope is cut if needed [C-01]. About 45 building hours, one builder [C-02] [C-10].
- Under $25 per month in total [C-03]. Outside data must be free [C-04], and its terms of use (credits, usage limits) are followed [C-14].
- Runs in the builder's existing AWS account, where AI model access is already on [C-07]. Fits the existing repository layout and shared types [C-06] [code-structure].
- Boston only, invite-only, backend API only [scope-document] [C-16].
- Practices from team-practices: branches and pull requests, test-after with 80% coverage, staging and production deployed by GitHub Actions, Prettier and ESLint [team-practices].

## Assumptions

| # | Assumption | Reason | To confirm |
|---|------------|--------|------------|
| A-1 | One plan costs about $0.10 to $0.30 in AI calls. | Feasibility estimate, never measured [feasibility-assessment]. | Measure the first real plan (accepted risk, approval-handoff Q1). |
| A-2 | Fewer than 10 people are invited by Nov 18, so at most about 30 plans a month. | approval-handoff Q2. | Watch the count of invited people. |
| A-3 | "After dark" is computed from that date's sunset in Boston. No separate list of sunset times is needed. | Sunset can be computed from the date and location. | Domain Design. |
| A-4 | Transit uses stored timetables; disruptions and live delays are ignored. | Free, stable data; S-03 asks only for last-train awareness. | None. |
| A-5 | The admin invites and deletes accounts with a documented admin action (console or script), not a public endpoint. | Q1 names one admin, and Q8 rules out an admin API for data. | Domain Design. |
| A-6 | The existing shared types are a starting point. Revise (`ReviseRequest`, version increments) and `FrontendConfig` are not used in this version, and invitation, quota and deletion fields are added. | The code scan found the types do not match the scope [business-overview]. | Contract Design. |

## Out of Scope

- Cities other than Boston; public self sign-up; a total monthly limit across all users [scope-document].
- The traveler web app. It is planned as separate work after Nov 18 [Q5] [C-16].
- Revising an existing plan [C-16].
- Live transit delays, taxis or ride-hailing in plans, weather-based planning, and making bookings (links only, FR15) [scope-document].
- The "safety not checked" warning for cities without safety data, since only Boston is planned [scope-document].

## Open Questions

- Which email sender and address send invitations, and whether the default email limits of the sign-in service are enough for fewer than 10 invitations (Domain Design / Infrastructure Design).
- Whether the curated catalog (places, stations, safety areas) is also exposed to travelers through an endpoint, or used only inside plan building (Contract Design). The code scan found a declared `GET /catalog` whose place in scope is unclear [code-structure].

## Sources

- Initial description: build the jarvel backend API [desc]
- `ideation/intent-capture/intent-statement.md` [intent-statement]
- `ideation/scope-definition/scope-document.md` [scope-document], capabilities S-01 to S-11
- `ideation/feasibility/constraint-register.md` C-01 to C-16; `ideation/feasibility/feasibility-assessment.md`
- `ideation/approval-handoff/approval-handoff-questions.md` (Q1 to Q4)
- `aidlc/spaces/default/codekb/jarvel/business-overview.md` [business-overview], `architecture.md`, `code-structure.md` [code-structure], `api-documentation.md`
- `inception/practices-discovery/team-practices.md` [team-practices]
- `inception/requirements-analysis/requirements-analysis-questions.md` [Q1] to [Q8]
- `.claude/knowledge/aidlc-product-agent/corner-checklist.md` [corner-checklist]

## Assumptions & Open Questions

See the Assumptions and Open Questions sections above.
