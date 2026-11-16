# Intent Capture & Framing — Questions

## Sources

- [desc] Initial description: "build the jarvel backend API"
- [scope] Workflow-selected scope: `feature`.

Context: the repository already holds a design note at `docs/ARCHITECTURE.md` describing Jarvel as a Boston multi-agent trip planner, and shared types in `shared/src/types.ts`. The questions below check which parts of that picture are the real intent for this piece of work. Nothing from that note is treated as decided until you confirm it here.

## Q1. What problem should the Jarvel backend solve?

`docs/ARCHITECTURE.md` describes a planner that builds a day-by-day Boston itinerary for one traveler (arrive Wed Nov 18 2026, leave Sat Nov 21 2026), prioritising safety, an unhurried pace, subway travel and a cost estimate.

A. Exactly that: plan one specific Boston trip (Nov 18-21, 2026) safely and at a relaxed pace, as the design note describes
B. A general trip planner for any city and any dates
C. Boston trip first, built so it can be generalised to other trips later
D. Not yet defined
X. Other (please specify)

[Answer]: B

## Q2. Who will use it?

The design note says self sign-up is disabled and an administrator creates each account.

A. Only me (single personal user)
B. Me plus a few people I invite (friends, family, travel companions)
C. The public / external customers
D. Not yet defined
X. Other (please specify)

[Answer]: C

## Q3. How will you know it worked? (select all that apply)

These become the success measures in the intent statement, so a number helps where you have one.

A. A full itinerary comes back within a few minutes of asking (say how many if you have a limit)
B. The plan never breaks a safety rule (no higher-risk area after dark, back at the hotel on time, on the last train)
C. Every must-see place on my wishlist is either scheduled or listed with a reason it could not fit
D. Running cost stays under a monthly amount I set (say the amount)
E. Not yet defined
X. Other (please specify)

[Answer]: A, B, C, D

## Q4. Why build it now?

A. The trip itself: it has to work before I travel on Nov 18, 2026
B. A learning or portfolio project (AWS, multi-agent AI)
C. Both the trip and learning
D. Not identified
X. Other (please specify)

[Answer]: C

## Q5. Who else cares about the outcome?

A. Only me
B. Me and the people travelling with me
C. A team, employer or reviewer who will look at the project
D. Not identified
X. Other (please specify)

[Answer]: B

## Q6. Who decides scope and priority when trade-offs come up?

A. I decide everything
B. I decide, with input from others (say who)
C. Someone else decides (say who)
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q7. Does anyone need progress updates?

A. No, I follow along in this chat
B. A short summary for me at the end of each phase
C. Updates to other people (say who and how often)
D. Not applicable
X. Other (please specify)

[Answer]: A

## Q8. What should this first version leave out? (select all that apply)

You asked for the backend API, and this work is set up with the feature workflow. This question is only about what the first version of the product does not do.

A. The web app the traveler uses (React frontend)
B. Deploying to AWS (the infrastructure stack)
C. Live outside data (weather forecast, crime statistics): use the curated data only
D. Revising an existing plan (the "revise" request)
E. None: the first version should do everything the design note describes for the backend
X. Other (please specify)

[Answer]: A, D

## Q9. What has to be working by your trip on Nov 18, 2026?

Follow-up: you chose a general planner for any trip (Q1), open to the public (Q2), and the trip itself is part of the reason for building it now (Q4). The trip starts in about a month, so these pull against each other.

A. Only planning my own Boston trip; the general, public version can come after
B. The general planner for any city, open to the public, all by Nov 18
C. The general planner by Nov 18, but only I use it then; public access comes later
D. No deadline: the trip date does not constrain the build
X. Other (please specify)

[Answer]: B

## Q10. Which places should the first version plan trips for?

Follow-up to Q1 (any trip). Safety guidance and subway routes are specific to each city, so this decides how much city knowledge the first version needs.

A. Boston only at first; other cities later
B. A short list of cities (name them)
C. Any city worldwide from the first version
D. Not yet defined
X. Other (please specify)

[Answer]: C

## Q11. How should members of the public get access?

Follow-up to Q2 (the public). The design note had an administrator create every account.

A. Anyone can sign up themselves, free
B. Anyone can sign up themselves, paid
C. Invite or approval only
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q12. What is the longest acceptable wait for an itinerary?

Follow-up to Q3, success measure A ("comes back within a few minutes"), which needs a number to be testable.

A. Under 1 minute
B. Under 3 minutes
C. Under 5 minutes
D. Not yet defined
X. Other (please specify)

[Answer]: C

## Q13. What monthly running cost should it stay under?

Follow-up to Q3, success measure D (cost cap), which needs an amount.

A. Under $25 per month
B. Under $50 per month
C. Under $100 per month
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q14. How many people do you expect to use it in the first three months?

Follow-up to Q2 (the public) and Q5 (only you and your companions care about the outcome). The answer shapes the cost cap and who counts as a stakeholder.

A. Fewer than 100
B. 100 to 1,000
C. More than 1,000
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q15. How should free public use stay inside the $25 monthly cap?

Follow-up: sign-up is free and open to anyone (Q11), every itinerary uses paid AI calls, and running cost must stay under $25 per month (Q13) for fewer than 100 users (Q14).

A. Limit how many plans each person can create (a small number per month) so the total stays under $25
B. Raise the cost cap (say the new amount)
C. Treat $25 as a target to watch, not a hard limit
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q16. In a city with no hand-checked safety knowledge, what should the planner do?

Follow-up: never breaking a safety rule is a success measure (Q3, B), and the planner must work for any city (Q10). For Boston the safety rules come from hand-checked area knowledge; most cities will not have that at first.

A. Still plan, using public safety information it can find, and label that information clearly
B. Still plan, but warn the traveler that safety was not checked for this city
C. Refuse to plan for a city until checked safety knowledge exists
D. Not yet defined
X. Other (please specify)

[Answer]: B

## Consolidated Summary Confirmation

- Problem: a general trip planner for any city and any dates, not only the one Boston trip [Q1, Q10]
- Users: the public, who sign up themselves for free; fewer than 100 people expected in the first three months [Q2, Q11, Q14]
- Why now: both the Nov 18, 2026 trip and learning; the general, public planner for any city must all work by Nov 18, 2026 [Q4, Q9]
- Success measures: itinerary returned in under 5 minutes; no safety rule broken; every must-see wishlist place scheduled or explained; running cost under $25 per month [Q3, Q12, Q13]
- Cost control: each person can create up to 3 plans per month so the total stays under $25 [Q15, Q18]
- Safety in cities without hand-checked knowledge: still plan, but warn the traveler that safety was not checked for that city [Q16]
- If the full first version cannot be ready by Nov 18, 2026: keep the date and cut the first version down to what fits [Q17]
- What public users want: a plan they can trust to keep them safe, a relaxed pace, getting around by public transport, and a trip cost estimate [Q19]
- Stakeholders: you and the people travelling with you; you alone decide scope and priority; no outside progress updates, you follow along in this chat [Q5, Q6, Q7]
- Left out of this first version: the web app (frontend) and revising an existing plan [Q8]

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct

## Assumption Confirmation

These points are kept as open assumptions in the intent statement and stakeholder map:

- Whether a general, public, any-city planner can be ready by Nov 18, 2026 (about one month away) has not been checked; the feasibility step should test this before scope is fixed.
- The exact monthly plan limit per person is not set yet; it has to be chosen so that fewer than 100 users stay under $25 per month in total.
- What public users want from the planner beyond a usable trip plan has not been asked; it stays an open question until requirements are gathered.

A. Accept assumptions
B. Convert to follow-up questions

[Answer]: B. Convert to follow-up questions

## Q17. If the feasibility check finds the full first version cannot be ready by Nov 18, 2026, what gives?

Follow-up to Q9 (everything by Nov 18) and Q10 (any city). Nobody has checked yet whether that fits in about a month.

A. Keep the Nov 18 date and cut the first version down to what fits
B. Keep the full first version and move the date
C. Both must hold; no trade-off
D. Not yet defined
X. Other (please specify)

[Answer]: A

## Q18. How many plans can each person create per month?

Follow-up to Q15 (limit plans per person) and Q13 (under $25 per month for fewer than 100 users).

A. 1 plan per month
B. 3 plans per month
C. 5 plans per month
D. Not yet defined: choose a number later from cost estimates
X. Other (please specify)

[Answer]: B

## Q19. What do public users most want from the planner? (select all that apply)

Follow-up to Q2 (the public). Your own priorities for the Boston trip were safety, a relaxed pace, travelling by subway and a cost estimate; this checks whether public users share them.

A. A plan they can trust to keep them safe
B. A relaxed, unhurried pace
C. Getting around by public transport rather than taxis
D. An estimate of what the trip will cost
E. Not yet defined
X. Other (please specify)

[Answer]: A, B, C, D
