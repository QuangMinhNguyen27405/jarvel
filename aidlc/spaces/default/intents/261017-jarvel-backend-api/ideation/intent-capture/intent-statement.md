# Intent Statement: Jarvel Backend API

This work builds the Jarvel backend API [desc].

## Problem Statement

Travelers need a planner that turns a trip into a day-by-day itinerary for any city and any dates, not only one specific Boston trip [Q1] [Q10].

The planner must keep travelers safe: a plan never breaks a safety rule, such as visiting a higher-risk area after dark, missing the last train, or getting back to the hotel late [Q3].

Where a city has no hand-checked safety knowledge, the planner still produces a plan and warns the traveler that safety was not checked for that city [Q16].

## Target Customer

Members of the public, who sign up themselves at no cost [Q2] [Q11].

Fewer than 100 people are expected to use it in the first three months [Q14].

The requester and the people travelling with them on the Nov 18, 2026 trip are among the first users [Q4] [Q5] [Q9].

Public users want a plan they can trust to keep them safe, a relaxed and unhurried pace, getting around by public transport rather than taxis, and an estimate of what the trip will cost [Q19].

## Success Metrics

| Metric | Target | Source |
|--------|--------|--------|
| Time to receive a complete itinerary | Under 5 minutes from the request | [Q3] [Q12] |
| Safety rules broken in a returned plan | Zero | [Q3] |
| Must-see wishlist places covered | 100% either scheduled or listed with a reason they could not fit | [Q3] |
| Total running cost | Under $25 per month | [Q3] [Q13] |
| Plans per person | At most 3 per month, so total cost stays under $25 | [Q15] [Q18] |
| Ready date | The general, public, any-city planner works by Nov 18, 2026 | [Q9] |

## Initiative Trigger

Two reasons drive this now: the requester's own trip starting Nov 18, 2026, and learning [Q4].

Everything in this first version, including public access and any-city planning, should work by Nov 18, 2026 [Q9].

If the full first version cannot be ready by Nov 18, 2026, the date holds and the first version is cut down to what fits [Q17].

## Initial Scope Signal

Workflow-selected scope: `feature` [scope].

User-confirmed product boundary for this first version:

- Out: the web app the traveler uses (frontend) [Q8].
- Out: revising an existing plan [Q8].
- In: planning trips for any city worldwide [Q10].
- In: free public self sign-up, with up to 3 plans per person per month [Q11] [Q15] [Q18].
- Rule for trade-offs: if everything cannot be ready by Nov 18, 2026, keep the date and cut scope [Q17].

## Assumptions & Open Questions

None.
