# Business Overview

## Purpose

Jarvel is a trip planner for Boston. It produces a day-by-day itinerary that takes safety by time of day into account, travels by public transport first, keeps a relaxed pace and estimates costs. The repository is an early skeleton. The domain is captured in one shared type file (`shared/src/types.ts`); no runtime behaviour has been built yet.

## Business Domain as Encoded in Code

The domain vocabulary below is taken from `shared/src/types.ts` (types only, no logic). Full type details: [code-structure.md](code-structure.md); route contract: [api-documentation.md](api-documentation.md).

| Concept | Types | What it represents |
|---|---|---|
| Curated city knowledge | `Place`, `PlaceCategory`, `Money` | Venues with opening hours, typical visit length, price level, reservation need, nearest station, safety area, sources and a `verified` flag |
| Transit network | `Line`, `LineId`, `Station`, `Edge`, `TransitNetwork` | Boston MBTA subway, light rail and Silver Line, with headways, first and last trains, fares and travel times between stations |
| Safety knowledge | `SafetyArea`, `RiskLevel`, `SafetyKnowledge` | Areas with day and night risk, an optional "avoid after" time, Boston Police districts, and a description of a crime-data endpoint |
| Trip defaults | `TripDefaults`, `WishlistEntry`, `HotelInfo` | One preset trip: hotel, arrival and departure, airport `BOS`, wishlist, November climate |
| Trip request | `TripRequest`, `TripPreferences`, `Pace`, `SafetyStrictness`, `BudgetLevel` | What a traveler asks for: dates, number of travelers, hotel, wishlist, pace, safety strictness, budget, maximum walk, day start and end |
| Plan lifecycle | `PlanRecord`, `PlanStatus`, `PlanSummary`, `ReviseRequest`, `AgentProgress`, `AgentName` | A user-owned plan (`userId` = Cognito subject) moving QUEUED → RUNNING → SUCCEEDED or FAILED, with a version number, revisions and progress for each agent (researcher, safety, transit, scheduler, critic, budget) |
| Itinerary output | `Itinerary`, `DayPlan`, `ItineraryItem`, `TransitLeg`, `TransitStep`, `WeatherSummary`, `CostBreakdown`, `CriticIssue` | Daily timelines of visits, meals, transit legs and rest, with safety notes, costs, weather, walking minutes, items left unscheduled and the critic's remaining issues |

## Key Business Rules Visible in Code

Only rules written into type comments exist. None of them is enforced by code.
- Times are Boston local time (`America/New_York`); dates are `YYYY-MM-DD` and times `HH:MM` in 24-hour form (`types.ts` line 3).
- `SafetyArea.avoidAfter`: "scheduler must not place visits here after this" (line 129).
- `TripPreferences.pace`: relaxed means at most about 3 major stops a day with buffers of at least 30 minutes (line 183). `safety: strict` also avoids areas with `moderate` night risk after dark (line 184).
- `StepState.needsRevision`: the scheduler and critic loop until there are no blockers or the iteration count reaches 2 (line 383).
- A plan belongs to a user through `PlanRecord.userId` (line 234), which implies authenticated, per-user ownership.

## Current Business Capability

**None delivered.** No endpoint, plan generation, data set, authentication or UI exists. See [component-inventory.md](component-inventory.md) for what exists in each package.

## Alignment With the Active Intent

The approved scope is Boston-only, invite-only, with at most 3 plans per person per month, no revise and no traveler web app. Compared with that scope, the existing contract:
- covers the plan, itinerary, safety and transit domain the must-haves need;
- includes revise and `FrontendConfig`, which this version leaves out;
- has no way to represent invitations or access control, or the monthly per-person plan quota.

These gaps are recorded in [code-quality-assessment.md](code-quality-assessment.md). Requirements Analysis must resolve them.
