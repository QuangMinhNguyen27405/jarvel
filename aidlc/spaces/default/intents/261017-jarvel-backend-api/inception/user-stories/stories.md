# User Stories

Source: `inception/requirements-analysis/requirements.md`, plus the answers in `user-stories-questions.md`.
Personas: P1 Invited Traveler and P2 Admin (`personas.md`).
Grouping: by the traveler's journey, with admin stories in their own group [Q2].

Each story carries:
- **Priority**: MoSCoW.
- **Slice**: `Nov 1` means it is part of the first working plan for the requester's own trip. `Nov 18` means it is needed by launch [Q5].
- **Covers**: the requirement IDs it covers.
- **Depends on**: stories it builds on. These are the only cross-story links; every story is testable on its own with test data.

## Story Map

| Journey step | Nov 1 slice | Nov 18 (Must) | Should |
|---|---|---|---|
| 1. Getting in | US1.1, US1.2, US1.3 | | |
| 2. Asking for a plan | US2.1, US2.2 | US2.3, US2.4, US2.5 | |
| 3. Waiting for it | US3.1, US3.2, US3.3 | | |
| 4. The plan itself | US4.1 to US4.7 | | US7.1, US7.2, US7.3, US7.6 |
| 5. Reading and removing | US5.1, US5.2 | US5.3, US5.4 | US7.4, US7.5 |
| 6. Admin | US6.1, US6.4 | US6.2, US6.3, US6.5 | |

## 1. Getting In

### US1.1 Set my own password on first sign-in
As an **Invited Traveler**, I want to sign in with the temporary password from my invitation and set my own, so that only I can get into my account.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR1.2 | **Depends on**: US6.1
- **AC1.1.1** Given I was invited and hold a temporary password, When I sign in with it, Then I am asked to set a new password before anything else.
- **AC1.1.2** Given I have not yet set a new password, When I call any plan endpoint, Then the call is refused and no data is returned.
- **AC1.1.3** Given I have set a new password, When I sign in with it, Then I receive a session that the API accepts.
- **AC1.1.4** Given I enter a new password that breaks the password rules, When I submit it, Then I am told which rule failed and the temporary password still works.

### US1.2 Only invited, signed-in people get in
As an **Invited Traveler**, I want the API to refuse anyone who is not invited and signed in, so that my plans and the planner stay private to the invited group.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR1, FR1.3, FR1.4 | **Depends on**: none
- **AC1.2.1** Given a request with no token, When it reaches any endpoint except the health check, Then it gets 401 and no data.
- **AC1.2.2** Given an expired or forged token, When it is used, Then it gets 401 and no data.
- **AC1.2.3** Given someone who was never invited, When they try to sign up themselves, Then the attempt is refused.
- **AC1.2.4** Given the health check, When it is called without a token, Then it answers that the service is up and returns no user or plan data.

### US1.3 My plans are mine alone
As an **Invited Traveler**, I want only myself to be able to read or delete my plans, so that other travelers cannot see where I will be and when.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR1.5 | **Depends on**: US1.2
- **AC1.3.1** Given person A owns a plan, When person B asks for it by id, Then B gets 404, the same answer as for an id that does not exist.
- **AC1.3.2** Given person A owns a plan, When person B tries to delete it, Then B gets 404 and the plan is unchanged.
- **AC1.3.3** Given person A owns a plan, When person A asks for it, Then A gets the plan.

## 2. Asking for a Plan

### US2.1 Ask for a Boston trip plan
As an **Invited Traveler**, I want to send my dates, travelers, hotel, wishlist and preferences and get a plan id back at once, so that I know my plan is being built without waiting on an open connection.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR2, FR2.3 | **Depends on**: US1.2
- **AC2.1.1** Given a valid request, When I submit it, Then I get a plan id and the status `QUEUED` in under 2 seconds.
- **AC2.1.2** Given a valid request, When I submit it, Then the stored plan keeps the request exactly as I sent it.
- **AC2.1.3** Given a valid request without optional fields (title, notes, dietary), When I submit it, Then it is accepted with documented defaults.

### US2.2 Get told exactly what is wrong with my request
As an **Invited Traveler**, I want an invalid request rejected with every problem named, so that I can fix it in one go without losing one of my monthly plans.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR2.1, FR2.2, FR2.7 | **Depends on**: US2.1
- **AC2.2.1** Given a trip of 7 days, 6 travelers and 15 wishlist places arriving 12 months ahead, When I submit it, Then it is accepted.
- **AC2.2.2** Given a request one step past any limit (8 days, 7 travelers, 16 places, a past arrival, an arrival 12 months and 1 day ahead, or departure before arrival), When I submit it, Then I get 400.
- **AC2.2.3** Given a request with two invalid fields, When I submit it, Then one 400 answer names both fields and why.
- **AC2.2.4** Given a hotel more than a 30-minute walk from every stored station, When I submit it, Then I get 400 saying the hotel is outside the area the planner covers.
- **AC2.2.5** Given any rejected request, When I check my monthly count, Then it is unchanged.

### US2.3 Send my request again without making a duplicate
As an **Invited Traveler**, I want a retried submit to give back the same plan, so that a dropped connection never costs me a second plan.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: FR2.6 | **Depends on**: US2.1
- **AC2.3.1** Given I submitted a request with an idempotency key, When I submit the same request with the same key again, Then I get the same plan id and my count goes up by 1 in total.
- **AC2.3.2** Given I reuse a key with a different request body, When I submit it, Then I get a conflict error and no new plan.
- **AC2.3.3** Given a submit without a key, When I send it, Then it is treated as a new request.

### US2.4 Stay within 3 plans a month
As an **Admin**, I want each traveler limited to 3 counted plans per calendar month in Boston time, so that the total cost stays under $25 a month.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: FR6, FR6.2, FR6.3 | **Depends on**: US2.1
- **AC2.4.1** Given a traveler has 3 counted plans this month, When they submit a 4th, Then they get 429 with the limit (3), the number used (3) and the reset date.
- **AC2.4.2** Given it is 00:00 Boston time on the 1st, When that traveler submits, Then the request is accepted.
- **AC2.4.3** Given a traveler has used 2, When 5 requests arrive at the same moment, Then exactly 1 is accepted and 4 get 429.
- **AC2.4.4** Given the month changes during a daylight-saving week, When the reset is computed, Then it uses Boston local midnight.

### US2.5 Don't lose a plan for something that wasn't my fault
As an **Invited Traveler**, I want my count given back when my plan fails through no fault of mine, so that I still get 3 usable plans a month.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: FR6.1, FR8.3 | **Depends on**: US2.4
- **AC2.5.1** Given my plan ends `FAILED` because of a timeout, AI error or internal error, When I check my count, Then it is given back.
- **AC2.5.2** Given my plan ends `FAILED` because no safe schedule or last-train-safe route exists, When I check my count, Then it is given back [user-stories Q6].
- **AC2.5.3** Given my plan succeeded and I delete it, When I check my count, Then it is unchanged.
- **AC2.5.4** Given one of my plans failed on our side this month, When I make 3 more requests that succeed, Then all 3 are accepted.

## 3. Waiting for the Plan

### US3.1 See how my plan is getting on
As an **Invited Traveler**, I want to see my plan's status and progress while it is built, so that I know it is working and roughly how far along it is.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR2.4 | **Depends on**: US2.1
- **AC3.1.1** Given a plan being built, When I fetch it, Then I see `QUEUED` or `RUNNING` and the progress of each step so far.
- **AC3.1.2** Given a plan, When its status changes, Then it only moves `QUEUED` → `RUNNING` → `SUCCEEDED` or `FAILED`.
- **AC3.1.3** Given a plan that is `SUCCEEDED` or `FAILED`, When anything happens later, Then its status never changes again.

### US3.2 Get my plan within 5 minutes or a clear failure
As an **Invited Traveler**, I want my plan finished within 5 minutes, or told clearly that it failed, so that I am never left waiting on a plan that will not come.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR2.5, NFR1 | **Depends on**: US3.1
- **AC3.2.1** Given a plan forced to stall, When 5 minutes have passed since it was accepted, Then it shows `FAILED` and a readable reason by 6 minutes at the latest.
- **AC3.2.2** Given the last 20 plans in staging, When their times are measured, Then at least 19 succeeded within 5 minutes.
- **AC3.2.3** Given a `FAILED` plan, When I fetch it, Then the reason says what went wrong in plain words and shows no internal error details.

### US3.3 A passing hiccup doesn't ruin my plan
As an **Invited Traveler**, I want a bad or failed AI answer retried before my plan fails, so that one glitch does not cost me a plan.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: NFR9 | **Depends on**: US3.1
- **AC3.3.1** Given a fake AI that returns badly structured output twice and then good output, When the plan is built, Then it ends `SUCCEEDED` as one plan with one count.
- **AC3.3.2** Given a fake AI that returns bad output three times, When the plan is built, Then it ends `FAILED` and the count is given back.
- **AC3.3.3** Given any AI answer, When it is received, Then it is checked against the expected structure before it is used.

## 4. The Plan Itself

### US4.1 A day-by-day timeline for my whole trip
As an **Invited Traveler**, I want a timeline for every day from arrival to departure that fits my day start and back-at-hotel time, so that I know exactly what each day looks like.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR3, FR3.2, FR3.3, FR3.4 | **Depends on**: none (built from test data)
- **AC4.1.1** Given a trip from Nov 18 10:00 to Nov 21 15:00, When the plan succeeds, Then it has exactly 4 days and no items in a day overlap.
- **AC4.1.2** Given an arrival time, When day 1 is planned, Then no item starts before arrival plus travel to the hotel.
- **AC4.1.3** Given a departure time, When the last day is planned, Then it ends at the hotel or airport before departure.
- **AC4.1.4** Given a day start of 09:00 and a back-at-hotel time of 21:30, When each day is planned, Then the first item starts at or after 09:00 and I am back at the hotel by 21:30.
- **AC4.1.5** Given a trip spanning a daylight-saving change, When times are shown, Then they are correct Boston local times on both sides, as `YYYY-MM-DD` and 24-hour `HH:MM`.

### US4.2 Every wishlist place is planned or explained
As an **Invited Traveler**, I want every place on my wishlist either scheduled or listed with a reason, so that I know nothing I asked for was silently dropped.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR3.1, FR3.5 | **Depends on**: US4.1
- **AC4.2.1** Given a wishlist, When the plan succeeds, Then each entry appears exactly once, either in the timeline or in the unscheduled list with a non-empty reason.
- **AC4.2.2** Given a wishlist entry not in the Boston data, When the plan succeeds, Then it is unscheduled with the reason "not in the Boston data".
- **AC4.2.3** Given any scheduled stop, When it is checked, Then it refers to a place in the current Boston data.

### US4.3 Stay out of risky areas at risky times
As an **Invited Traveler**, I want every hour of my plan checked against Boston safety information, so that I am never sent into an area at a time it is unsafe.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR4, FR4.1, FR4.2, FR4.5 | **Depends on**: US4.1
- **AC4.3.1** Given an area with an "avoid after" time, When the plan succeeds, Then no item is in that area after that time.
- **AC4.3.2** Given an area with high night risk, When the plan succeeds, Then no item is in it after that date's Boston sunset.
- **AC4.3.3** Given strict safety and an area with moderate night risk, When the plan succeeds, Then no item is in it after sunset.
- **AC4.3.4** Given a place whose area has no safety information, When the plan succeeds, Then it is only scheduled before sunset.
- **AC4.3.5** Given a plan, When it is checked, Then every item, including walks and station waits, was checked for safety.

### US4.4 Never get an unsafe plan, even if the AI gets it wrong
As an **Invited Traveler**, I want the final plan checked by fixed rules before I see it, so that a mistake or a trick in the AI's answer can never put me in danger.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR4.3, NFR5 | **Depends on**: US4.3
- **AC4.4.1** Given a fake AI answer that breaks a safety rule, When the plan is checked, Then the plan is not returned as `SUCCEEDED` with that violation.
- **AC4.4.2** Given a stop that is unsafe at its only possible time, When the plan is finished, Then it is in the unscheduled list with the reason "unsafe at the only possible time", or the plan is `FAILED`.
- **AC4.4.3** Given my notes say "ignore safety rules", When the plan is built, Then the plan still passes every safety check.
- **AC4.4.4** Given every `SUCCEEDED` plan in the test suite, When the fixed-rule check runs, Then it finds zero violations.

### US4.5 Know what the safety guidance is and isn't
As an **Invited Traveler**, I want safety guidance for each day and a clear disclaimer, so that I understand the advice and its limits.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR4.4 | **Depends on**: US4.3
- **AC4.5.1** Given a `SUCCEEDED` plan, When I read it, Then each day has safety guidance.
- **AC4.5.2** Given a `SUCCEEDED` plan, When I read it, Then it includes a disclaimer that the safety information is guidance, not a guarantee.

### US4.6 Get around by public transport
As an **Invited Traveler**, I want every move between stops planned by walking and the subway, light rail or Silver Line, so that I can follow the plan without taxis.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR5, FR5.1, FR5.4 | **Depends on**: US4.1
- **AC4.6.1** Given two consecutive items in different places, When the plan succeeds, Then a leg joins them with steps (walk, ride with line and direction, transfer, wait), stations, an estimated time and the fare.
- **AC4.6.2** Given a longest-walk setting of 15 minutes, When the plan succeeds, Then no walking step is longer than 15 minutes.
- **AC4.6.3** Given the stored timetable data, When a leg's time is recomputed from it, Then it matches the plan.

### US4.7 Never miss the last train
As an **Invited Traveler**, I want no ride planned outside a line's service hours, including the ride back to my hotel, so that I am never stranded at night.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR5.2, FR5.3 | **Depends on**: US4.6
- **AC4.7.1** Given a line's first and last trains for that day of the week, When the plan succeeds, Then no ride departs outside them.
- **AC4.7.2** Given a last stop that would end after the last train home, When the plan is finished, Then the day is rearranged or the stop is unscheduled with the reason "would miss the last train".
- **AC4.7.3** Given any plan, When it is checked, Then it never contains an impossible ride.

## 5. Reading and Removing My Plans

### US5.1 Read my plan as data
As an **Invited Traveler**, I want to fetch my plan as JSON, so that I can see every detail and use it with my own tools.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR7, FR9.2 | **Depends on**: US3.1
- **AC5.1.1** Given a `SUCCEEDED` plan, When I fetch it as JSON, Then I get the status, progress and the full plan.
- **AC5.1.2** Given a `FAILED` plan, When I fetch it, Then I get its reason.
- **AC5.1.3** Given a `SUCCEEDED` plan, When I fetch it, Then it shows the Boston data version it was built from and the source credits.

### US5.2 Read my plan comfortably
As an **Invited Traveler**, I want the same plan as readable Markdown, so that I can follow it on my trip without a web app.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR7.1 | **Depends on**: US5.1
- **AC5.2.1** Given a `SUCCEEDED` plan, When I fetch it as Markdown, Then every stop and leg in the JSON also appears in the Markdown.
- **AC5.2.2** Given a `SUCCEEDED` plan, When I fetch it as Markdown, Then it includes the safety guidance, the disclaimer and the unscheduled list.
- **AC5.2.3** Given a plan that is not finished, When I fetch it as Markdown, Then I see its status instead of an empty plan.

### US5.3 Delete one of my plans
As an **Invited Traveler**, I want to delete a plan, so that my travel details are not kept when I no longer want them.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: FR8 | **Depends on**: US1.3
- **AC5.3.1** Given my plan, When I delete it, Then fetching it afterwards gets 404.
- **AC5.3.2** Given my deleted plan, When storage is checked, Then its records and files no longer exist.
- **AC5.3.3** Given a plan id that does not exist or is not mine, When I delete it, Then I get 404.

### US5.4 Old plans clean themselves up
As an **Invited Traveler**, I want my plans removed automatically 90 days after my trip, so that my travel history is not kept forever.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: FR8.2 | **Depends on**: none
- **AC5.4.1** Given a plan whose departure was 91 days ago, When the cleanup has run, Then the plan no longer exists.
- **AC5.4.2** Given a plan whose departure was 89 days ago, When the cleanup has run, Then the plan still exists.

## 6. Admin

### US6.1 Invite a person by email
As the **Admin**, I want to invite someone by email, so that only people I choose can use the planner.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR1.1 | **Depends on**: none
- **AC6.1.1** Given an email address, When I invite it, Then that address receives an email with a temporary password.
- **AC6.1.2** Given an address that is already invited, When I invite it again, Then no second account is created and I am told it already exists.
- **AC6.1.3** Given the documented admin action, When anyone other than the admin tries it, Then it is refused.

### US6.2 Disable a person
As the **Admin**, I want to disable an invited person, so that I can remove access quickly if I need to.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: FR1.6 | **Depends on**: US6.1
- **AC6.2.1** Given an invited person, When I disable them, Then their requests are refused within 1 hour.
- **AC6.2.2** Given a disabled person, When they try to sign in, Then sign-in is refused.

### US6.3 Delete a whole account on request
As the **Admin**, I want to delete a person's account and everything in it, so that I can honour a deletion request.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: FR8.1 | **Depends on**: US6.1
- **AC6.3.1** Given a person with plans, When I delete their account, Then their sign-in identity, plans and stored files are gone.
- **AC6.3.2** Given a deleted account, When storage is searched for that person's id, Then nothing is found.

### US6.4 Keep the Boston data correct
As the **Admin**, I want the Boston places, safety areas and transit data kept as versioned files that are checked before every deploy, so that a mistake in the data never reaches a traveler.
- **Priority**: Must | **Slice**: Nov 1 | **Covers**: FR9, FR9.1 | **Depends on**: none
- **AC6.4.1** Given a data file with a place pointing to a missing station or safety area, When CI runs, Then the check fails and the deploy is stopped.
- **AC6.4.2** Given a time that is not a valid `HH:MM`, When CI runs, Then the check fails.
- **AC6.4.3** Given a valid change to the data files, When it is deployed, Then new plans show the new data version.
- **AC6.4.4** Given the API, When any endpoint is called, Then none of them changes the Boston data.

### US6.5 Watch cost and failures
As the **Admin**, I want each plan's AI cost recorded and alarms for spend and failures, so that I find problems before travelers or my bill do.
- **Priority**: Must | **Slice**: Nov 18 | **Covers**: NFR3, NFR8 | **Depends on**: US2.1
- **AC6.5.1** Given a finished plan, When I look at its record, Then it shows its AI cost.
- **AC6.5.2** Given monthly spend reaches $20, When billing is checked, Then an alarm notifies me.
- **AC6.5.3** Given a deliberately failed plan in staging, When metrics are checked, Then the failed-plan metric records it and its alarm can fire.

## 7. Should-Haves (only if time remains)

### US7.1 A relaxed pace
As an **Invited Traveler**, I want a relaxed day to have at most 3 major stops and at least 30 minutes between items, so that I am not rushed.
- **Priority**: Should | **Slice**: Nov 18 | **Covers**: FR10 | **Depends on**: US4.1
- **AC7.1.1** Given relaxed pace, When the plan succeeds, Then no day has more than 3 major stops.
- **AC7.1.2** Given relaxed pace, When the plan succeeds, Then there are at least 30 minutes between consecutive items.
- **AC7.1.3** Given a wishlist that does not fit at a relaxed pace, When the plan succeeds, Then the extra places are unscheduled with the reason "does not fit at a relaxed pace".

### US7.2 Know roughly what it will cost
As an **Invited Traveler**, I want an estimated trip cost, so that I can budget.
- **Priority**: Should | **Slice**: Nov 18 | **Covers**: FR11 | **Depends on**: US4.6
- **AC7.2.1** Given a plan, When I read its costs, Then transit, food and entry fees add up exactly to the total, in US dollars with whole cents.
- **AC7.2.2** Given a cost, When it is shown, Then it is labelled as an estimate.
- **AC7.2.3** Given a place with no known price, When costs are shown, Then it is shown as unknown, not as free.

### US7.3 Only visit places when they are open
As an **Invited Traveler**, I want every stop scheduled inside its opening hours, so that I never arrive at a closed door.
- **Priority**: Should | **Slice**: Nov 18 | **Covers**: FR12 | **Depends on**: US4.1
- **AC7.3.1** Given a place's opening hours for that date, When the plan succeeds, Then the visit starts and ends inside them.
- **AC7.3.2** Given a place closed on all trip dates, When the plan succeeds, Then it is unscheduled with the reason "closed on your dates".

### US7.4 See my past plans
As an **Invited Traveler**, I want to list my plans, newest first, so that I can find one again.
- **Priority**: Should | **Slice**: Nov 18 | **Covers**: FR13 | **Depends on**: US1.3
- **AC7.4.1** Given I have plans, When I list them, Then I see only mine, newest first, with a stable order for equal times.
- **AC7.4.2** Given I have no plans, When I list them, Then I get an empty list, not an error.

### US7.5 Share a plan with my companions
As an **Invited Traveler**, I want to share a read-only link to a plan, so that my companions can follow it.
- **Priority**: Should | **Slice**: Nov 18 | **Covers**: FR14 | **Depends on**: US5.2
- **AC7.5.1** Given a shared link, When someone opens it without signing in, Then they see the plan.
- **AC7.5.2** Given a shared link, When someone tries to change or delete the plan through it, Then they are refused.
- **AC7.5.3** Given I delete the plan, When the shared link is opened, Then it gets 404.

### US7.6 Book what needs booking
As an **Invited Traveler**, I want a booking link on stops that need a reservation, so that I can secure them before the trip.
- **Priority**: Should | **Slice**: Nov 18 | **Covers**: FR15 | **Depends on**: US4.2
- **AC7.6.1** Given a scheduled stop marked as needing a reservation, When I read the plan, Then the stop has a booking or reservation link.
- **AC7.6.2** Given a stop that needs no reservation, When I read the plan, Then no link is shown.

## INVEST Notes

- **Independent:** each story is testable with test data and faked AI and AWS calls (team-practices). The "Depends on" links show build order, not test order.
- **Small:** one behaviour per story, 2 to 5 acceptance criteria each.
- **Testable:** every acceptance criterion has a concrete Given/When/Then that an automated test can check.
- **Larger stories:** US4.3 and US4.4 hold the most logic. They are split by rule (area rules vs the final check) rather than by layer.
