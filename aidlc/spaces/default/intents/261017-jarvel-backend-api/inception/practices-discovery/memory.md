<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-23T03:27:45Z — Treated every org.md practice as a suggested default, tagged per statement; the repository has one README-only commit, so almost nothing about team habits is observable. Each line in team-practices.md carries an evidenced / inferred / org-default tag so the interview can target only the defaults and inferences.
- 2026-10-23T03:27:45Z — Read the solo-builder constraint (C-10) as reshaping review and approval practices; the org default's "tech lead + product owner sign-off" and pull-request review collapse to the builder's own approval plus CI. Recorded as an inference, not a decided practice.
- 2026-10-23T03:33:02Z — Recorded the Prettier print width as 120 even though Q7 option A in the questions file said only "wider print width". 120 was the value in the lead's recommendation and in the summary the builder confirmed; evidence.md notes the gap so the ci-pipeline stage can confirm it when it writes the config.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-23T03:27:45Z — Kept the confirmed Mandated and Forbidden lists at `None.` and placed proposed rules under a "Proposed candidates" sub-section instead of writing them as rules. Hard rules must come from a person; the candidates exist only so the interview can ask about them, and integration must delete or promote them before practices-promote runs.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-23T03:27:45Z — Suggested Prettier settings that match the one existing file (single quotes, semicolons, wider print width) over Prettier defaults. Defaults would rewrite shared/src/types.ts on the first run; matching the observed style keeps the diff empty, at the cost of a small config file.
- 2026-10-23T03:27:45Z — Drafted Methodology as test-after (org default) even though no evidence supports any cadence. The field must hold exactly one value; test-after is the documented fallback, and the interview asks the person to confirm or change it.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-23T03:27:45Z — Staging plus production versus a single environment under the $25 cap and one AWS account. The org default expects both; a single-environment answer may be refused as a conflict at promotion, so the interview must say that plainly.
- 2026-10-23T03:27:45Z — The scaffold is untracked and main holds only the README. Branches, worktrees and CI built from main would not see the scaffold until it is committed; the conductor should raise this before Construction.
