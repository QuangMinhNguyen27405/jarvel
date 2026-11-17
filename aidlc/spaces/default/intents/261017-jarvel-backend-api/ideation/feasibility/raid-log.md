# RAID Log: Jarvel

Built from the approved intent statement (`ideation/intent-capture/intent-statement.md`), the market research (`ideation/market-research/competitive-analysis.md`, `market-trends.md`, `build-vs-buy.md`), the constraint register and the feasibility assessment.

## Risks

| ID | Risk | Likelihood | Impact | Mitigation | Source |
|----|------|-----------|--------|------------|--------|
| R-01 | The full first version does not fit in under about 45 hours of building time by Nov 18, 2026 | High | High | Apply the approved rule: keep the date, cut scope at Scope Definition | Feasibility assessment; Q4 |
| R-02 | AI cost per plan pushes running cost over $25 per month | High | High | Total monthly plan limit, fewer AI steps per plan, a smaller model; measure one real plan early | Feasibility assessment (cost estimate) |
| R-03 | Free sources lack opening hours or transit timetables in many cities | High | Medium | Limit the first version to cities with good data, or show clear warnings | Feasibility assessment; build vs buy |
| R-04 | Most cities have no open safety data, weakening Jarvel's main difference | High | High | Warn where safety was not checked (approved); start with cities that have data | Intent statement; competitive analysis |
| R-05 | Wrong safety advice could harm a traveler | Low | High | Disclaimers; never present a warning-only city as checked | Market trends; C-13 |
| R-06 | Free public sign-up attracts misuse that eats the budget | Medium | Medium | Per-person and total plan limits | Intent statement; C-05 |
| R-07 | Itinerary takes longer than 5 minutes when several AI steps run | Medium | Medium | Keep the number of AI steps small; measure early | Intent statement; C-09 |
| R-08 | One builder, no reviewer: mistakes go unnoticed | Medium | Medium | Automated tests at the 80% coverage floor | Q3; team testing rules |

## Assumptions

| ID | Assumption | Owner | Status | Source |
|----|-----------|-------|--------|--------|
| A-01 | About 60,000 tokens read and 8,000 written per plan | Builder | Unvalidated | Feasibility assessment |
| A-02 | Hosting, storage and test runs cost about $10 per month | Builder | Unvalidated | Feasibility assessment |
| A-03 | AI prices as listed in October 2026 third-party summaries | Builder | Unvalidated | Feasibility assessment |
| A-04 | Free sources cover places and transit well enough in the first cities chosen | Builder | Unvalidated | Build vs buy |
| A-05 | Fewer than 100 users in the first three months | Builder | Unvalidated | Intent statement |

## Issues

| ID | Issue | Source |
|----|-------|--------|
| I-01 | The approved first version (public, any city, hourly safety) exceeds the time and money available; Scope Definition must cut it | Feasibility assessment |
| I-02 | The safety success measure ("no safety rule broken") cannot be tested in cities without safety data | Feasibility assessment; intent statement |

## Dependencies

| ID | Dependency | Source |
|----|-----------|--------|
| D-01 | AWS account with AI model access (ready) | Q5 |
| D-02 | Existing Jarvel repository setup | Q1 |
| D-03 | Free outside sources for places, opening hours, transit and safety, still to be chosen | Build vs buy; Q7 |
| D-04 | Scope Definition decision on what to cut | Feasibility assessment |

## Assumptions & Open Questions

- The assumptions above (A-01 to A-05) are unvalidated; A-01 can be replaced by measuring one real plan.
