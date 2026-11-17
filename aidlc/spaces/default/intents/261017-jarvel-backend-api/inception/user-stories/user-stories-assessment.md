# User Stories Assessment

## Decision

**Execute.**

## Rationale

- The API serves two different users with different rights: invited travelers and one admin (`inception/requirements-analysis/requirements.md`, FR1).
- The core behaviour has complex business rules: hourly safety, last-train-aware transit, wishlist coverage, a monthly limit with refunds, and retention (FR3 to FR8). Stories with Given/When/Then criteria make each rule testable on its own.
- The Nov 1 milestone needs a clear first slice, and the requirements review asked for one (requirements review finding R-06). Stories are where that slice can be marked.

## Factors Considered

| Factor | Finding |
|--------|---------|
| Project type | Brownfield scaffold, new feature work. Only the shared types exist (`aidlc/spaces/default/codekb/jarvel/business-overview.md`, `component-inventory.md`). |
| User-facing scope | An API used directly by travelers and the admin. There is no web app in this version (requirements Q5). |
| Complexity signals | Safety and transit rules, AI output validation, quota concurrency, privacy deletion. |
| Team practices | Test-after with 80% coverage. Each acceptance criterion is written so that an automated test can check it, with paid AWS and AI calls faked (`inception/practices-discovery/team-practices.md`). |

## Where Stories Add the Most Value

- Safety and transit (US4.3, US4.4, US4.7): the "zero safety rules broken" promise turned into checkable cases.
- The monthly limit and its refunds (US2.4, US2.5): the edge cases around failures, deletion and requests sent at the same time.
- The Nov 1 slice: every story is tagged `Nov 1` or `Nov 18`.

## Decisions Made Here That Extend the Requirements

- **Safety-driven failures give the count back** (user-stories Q6). A plan that fails because no safe schedule or no last-train-safe route exists returns its monthly count. This widens FR6.1, which named only failures on our side. US2.5 carries it. Domain Design should treat it as part of the refund rule.
