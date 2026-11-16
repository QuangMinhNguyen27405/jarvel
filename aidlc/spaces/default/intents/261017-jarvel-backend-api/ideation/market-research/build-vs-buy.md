# Build vs Buy: Jarvel

Decision input for the approved intent statement (`ideation/intent-capture/intent-statement.md`): a free, public, any-city planner, ready by Nov 18, 2026, running under $25 per month.

## Decision

Build all of the planning ourselves, and take place, transit and safety information from outside sources (Answer Q4, Q8).

## Assessment

Scores: -2 strongly favours buy, +2 strongly favours build.

| Factor | Planning (itinerary, safety and pace rules) | City information (places, hours, transit, safety data) |
|--------|---------------------------------------------|--------------------------------------------------------|
| Core differentiator? | Yes: hourly safety, enforced pace, transit-first are the difference (Answer Q2). +2 | No: users judge the plan, not who collected the data. -2 |
| Time to market (Nov 18, 2026) | Must build; no product offers these rules (competitive analysis). +1 | Collecting it for every city by hand would not fit the date (Answer Q8). -2 |
| Cost (under $25/month) | Mostly our own effort. +1 | Outside sources may charge per use; must fit the cap. 0 (unknown) |
| Learning goal | Building it is part of the goal (Answer Q4; intent trigger). +2 | Little learning value in hand-collecting data. -1 |
| Control over safety advice | Needed: we are responsible for the advice given (Answer Q7). +2 | Accuracy depends on the source; mitigated by warning where not checked (approved intent). -1 |
| **Total** | **+8: build** | **-6: use outside sources** |

## Alternatives Rejected

- **Use an existing product instead of building**: no competitor applies safety hour by hour inside a plan (competitive analysis), and building is part of the learning goal (Answer Q4).
- **Gather our own city information for every city**: does not fit the Nov 18 date for a planner that covers any city (Answer Q8).

## Consequences

- Outside data sources must be chosen with their usage terms, cost and coverage in mind (Answer Q7); this is for the feasibility step.
- Where an outside source has no safety information for a city, the planner warns that safety was not checked (approved intent).

## Assumptions & Open Questions

- Assumption: outside sources exist that cover places, opening hours and transit for most cities within the $25 monthly cap. Not yet checked; the feasibility step should test it.
- Assumption: outside safety information is uneven by country (several safety tools rely on national police data, per the market trends sources).
