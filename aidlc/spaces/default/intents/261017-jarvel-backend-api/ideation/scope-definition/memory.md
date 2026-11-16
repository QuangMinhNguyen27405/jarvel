<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-19T15:19:43Z — Treated invite-only sign-up (Q2) as requiring an invite-only access item (IB-04) in the must-have list; without it the plan limit and invite-only launch cannot be enforced.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-19T15:19:43Z — Added two follow-up questions (Q8 checkpoint date, Q9 what gives way) to the questions file; Q6 picked an earlier checkpoint without a date, and Q3 plus Q4 kept every capability against about 45 hours of building time.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-19T15:19:43Z — Ordered the should-have items myself (relaxed pace and cost estimate first, from the intent statement) because Q9 set them as should-have but gave no order; flagged as a suggestion in the backlog.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-19T15:19:43Z — How data deletion is handled for invited people if "past plans" (IB-09) is not built, given privacy rules (C-12); and who sends invitations.
