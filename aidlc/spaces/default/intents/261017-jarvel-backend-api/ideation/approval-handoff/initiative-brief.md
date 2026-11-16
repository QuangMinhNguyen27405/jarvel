# Initiative Brief: Jarvel, Nov 18 Version

One page that brings together everything decided during Ideation, for a go or no-go before requirements work starts.

## Intent and Problem

Travelers need a planner that turns a trip into a day-by-day plan that keeps them safe: no higher-risk area after dark, no missed last train, no late return to the hotel [intent statement].

Two reasons drive this now: the requester's own Boston trip starting Nov 18, 2026, and learning [intent statement].

## Market Validation

- Itinerary apps (Mindtrip, Layla, Wanderlog) plan trips but do not check safety by time of day; safety tools (TripIt safety scores, GeoSure) score areas but do not plan [competitive analysis].
- Jarvel's difference is putting the two together: hourly safety inside the plan, a relaxed pace, public transport first with the last train in mind, and a cost estimate [competitive analysis].
- This is a hypothesis from vendor-written comparisons, not a hands-on test [competitive analysis].
- Decision: build the planning ourselves, take city information from free outside sources [build vs buy].

## Feasibility and Risk Highlights

The full public, any-city version did not fit under about 45 hours of building time and $25 per month by Nov 18, 2026, so the scope was cut and the date kept [feasibility assessment] [C-01] [C-02] [C-03].

| Risk | Planned answer | Source |
|------|----------------|--------|
| The cost of one plan is not measured yet | Measure one real plan early | [Q1] [feasibility assessment] |
| About 45 building hours is tight even for the five must-haves | Should-haves stay optional | [Q1] [intent backlog] |
| A wrong safety call could harm a traveler | Add a disclaimer to safety guidance | [Q1] [C-13] |

## Scope Boundary

In by Nov 18, 2026 (must-have): a day-by-day Boston plan, hourly safety from hand-checked Boston information, public transport between stops aware of the last train, invite-only access, and at most 3 plans per person per month [scope document].

Should-have, only if time remains: relaxed pace rules, cost estimate, opening hours, past plans, sharing, booking links [scope document].

Out for this version: other cities, public self sign-up, a total monthly plan limit, revising a plan, and the web app the traveler uses [scope document].

Checkpoints: a first working plan for the requester's own trip by Nov 1, 2026; all must-haves by Nov 18, 2026 [scope document].

Fewer than 10 people will be invited by Nov 18, which keeps the $25 monthly cap within the estimate [Q2] [scope document].

The Boston safety information is prepared by the requester, by hand, from their own knowledge and public sources; that time comes out of the same building hours [Q3].

## Concept Visuals

None. Rough mockups were skipped because this version has no traveler-facing screens [scope document] [C-16].

## Team Plan

One builder, the requester, with AI help; comfortable with TypeScript and AWS. Team formation was skipped: there is no team to staff [stakeholder map] [C-10].

## Go / No-Go Recommendation

**Go.** Continue to requirements with the cut-down Boston, invite-only version [Q4].

## Sources

- Initial description: build the jarvel backend API [desc]
- Workflow-selected scope: `feature` [scope]
- `ideation/intent-capture/intent-statement.md`, `stakeholder-map.md`
- `ideation/market-research/competitive-analysis.md`, `build-vs-buy.md`
- `ideation/feasibility/feasibility-assessment.md`, `constraint-register.md`
- `ideation/scope-definition/scope-document.md`, `intent-backlog.md`
- [Q1] to [Q4]: `approval-handoff-questions.md`

## Assumptions & Open Questions

- Open, raised on Oct 21, 2026: the requester asked for the traveler web app, for laptop and mobile. The approved scope leaves it out of this version (IB-16, C-16). Whether to add it here, plan it as separate work, or keep it for later is decided at this approval.
- Open for Requirements Analysis: how deletion of personal data works for invited people if "past plans" (S-09) is not built [scope document] [C-12].
- Open for Requirements Analysis: who sends invitations, and how [scope document].
- Assumption: the per-plan cost and hosting estimates are guesses until one real plan is measured [feasibility assessment].
