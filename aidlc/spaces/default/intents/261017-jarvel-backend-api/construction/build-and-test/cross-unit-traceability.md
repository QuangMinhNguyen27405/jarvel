# Cross-Unit Traceability: Jarvel Backend API

## Verdict

**FAIL: 16 of 165 IDs are not covered.** 149 are covered with status `OK` and a target file that exists.

- **15 of the 16 are Should items that were never in the approved code plan.** They are 4 requirements (FR10, FR11, FR14, FR15) and their 11 acceptance criteria (US7.1, US7.2, US7.5, US7.6). The requirements say they are "built only if time remains".
- **1 of the 16 is a Must acceptance criterion: AC3.2.2.** It needs the times of the last 20 plans on staging, and nothing is deployed, so it cannot be measured yet.

Every Must requirement (FR1 to FR9.2 and NFR1 to NFR10) is covered. So is every Must acceptance criterion except AC3.2.2.

Checked on 2026-11-14. This build has no Units, so there is one source: `construction/code-generation/traceability.json`.

## What Was Checked

- **Requirements:** all 61 IDs in `inception/requirements-analysis/requirements.md` (FR1 to FR15 with their sub-items, and NFR1 to NFR10).
- **Acceptance criteria:** all 104 three-segment IDs in `inception/user-stories/stories.md` (AC1.1.1 to AC7.6.2).
- **The rule:** an ID is covered when `traceability.json` gives it status `OK` and its target file exists in the repository. Every `OK` target was found on disk.

## Not Covered

| ID | Kind | Status in `traceability.json` | Why | Where it goes next |
|---|---|---|---|---|
| FR10 | Should requirement | Deferred | Relaxed pace by rule was not in the approved code plan. | A later piece of work. |
| FR11 | Should requirement | Deferred | The trip cost estimate with whole cents was not in the approved code plan. | A later piece of work. |
| FR14 | Should requirement | Deferred | Read-only share links were not in the approved code plan. | A later piece of work. |
| FR15 | Should requirement | Deferred | Booking links were not in the approved code plan. | A later piece of work. |
| AC3.2.2 | Must acceptance criterion | Deferred | At least 19 of the last 20 staging plans finish within 5 minutes. It can only be measured on staging. | Deployment Execution (smoke check on staging). |
| AC7.1.1, AC7.1.2, AC7.1.3 | Should acceptance criteria | Deferred | They belong to FR10. | A later piece of work. |
| AC7.2.1, AC7.2.2, AC7.2.3 | Should acceptance criteria | Deferred | They belong to FR11. | A later piece of work. |
| AC7.5.1, AC7.5.2, AC7.5.3 | Should acceptance criteria | Deferred | They belong to FR14. | A later piece of work. |
| AC7.6.1, AC7.6.2 | Should acceptance criteria | Deferred | They belong to FR15. | A later piece of work. |

## Covered, but Only by Configuration or Code, Not by an Automated Test

These IDs have status `OK` and an existing target, so they count as covered above. Their target is an implementation file, because the behavior cannot be tested without a deployed stack. They still need the check named here.

| ID | Target | What still needs checking | Where |
|---|---|---|---|
| AC1.1.1 to AC1.1.4 (FR1.2) | `infra/lib/jarvel-stack.ts` | Cognito forces a new password at first sign-in and applies the password rules. | The smoke check after a deploy (`backend/README.md`, "Post-deploy smoke check", step 2). |
| NFR1 | `backend/src/lib/planner.ts` | 95% of plans succeed within 5 minutes. The 5-minute stop is tested; the 95% figure is not measurable locally. | Deployment Execution, with AC3.2.2. |
| NFR2 | `backend/src/handlers/api.ts` | Submit, fetch and delete answer within 2 seconds for 95% of calls. | Deployment Execution (staging smoke check). |
| NFR7 | `backend/src/handlers/api.ts` | The API is available 99% of the time over 30 days. | Observability Setup, then 30 days of running. |

## Covered Requirements

| ID | Priority | Target file |
|---|---|---|
| FR1 | Must | `infra/lib/jarvel-stack.ts` |
| FR1.1 | Must | `backend/scripts/admin.ts` |
| FR1.2 | Must | `infra/lib/jarvel-stack.ts` |
| FR1.3 | Must | `infra/lib/jarvel-stack.ts` |
| FR1.4 | Must | `backend/src/handlers/api.ts` |
| FR1.5 | Must | `backend/src/lib/store.ts` |
| FR1.6 | Must | `backend/scripts/admin.ts` |
| FR2 | Must | `backend/src/lib/schemas.ts` |
| FR2.1 | Must | `backend/src/lib/schemas.ts` |
| FR2.2 | Must | `backend/src/lib/schemas.ts` |
| FR2.3 | Must | `backend/src/handlers/api.ts` |
| FR2.4 | Must | `backend/src/lib/store.ts` |
| FR2.5 | Must | `backend/src/lib/planner.ts` |
| FR2.6 | Must | `backend/src/lib/idempotency.ts` |
| FR2.7 | Must | `backend/src/lib/schemas.ts` |
| FR3 | Must | `backend/src/lib/scheduler.ts` |
| FR3.1 | Must | `backend/src/lib/scheduler.ts` |
| FR3.2 | Must | `backend/src/lib/scheduler.ts` |
| FR3.3 | Must | `backend/src/lib/scheduler.ts` |
| FR3.4 | Must | `backend/src/lib/sun.ts` |
| FR3.5 | Must | `backend/src/lib/scheduler.ts` |
| FR4 | Must | `backend/src/lib/safety.ts` |
| FR4.1 | Must | `backend/src/lib/safety.ts` |
| FR4.2 | Must | `backend/src/lib/safety.ts` |
| FR4.3 | Must | `backend/src/lib/validator.ts` |
| FR4.4 | Must | `backend/src/lib/scheduler.ts` |
| FR4.5 | Must | `backend/src/lib/safety.ts` |
| FR5 | Must | `backend/src/lib/router.ts` |
| FR5.1 | Must | `backend/src/lib/router.ts` |
| FR5.2 | Must | `backend/src/lib/router.ts` |
| FR5.3 | Must | `backend/src/lib/scheduler.ts` |
| FR5.4 | Must | `backend/src/lib/router.ts` |
| FR6 | Must | `backend/src/lib/quota.ts` |
| FR6.1 | Must | `backend/src/lib/planner.ts` |
| FR6.2 | Must | `backend/src/lib/quota.ts` |
| FR6.3 | Must | `backend/src/lib/quota.ts` |
| FR7 | Must | `backend/src/handlers/api.ts` |
| FR7.1 | Must | `backend/src/lib/markdown.ts` |
| FR8 | Must | `backend/src/lib/store.ts` |
| FR8.1 | Must | `backend/scripts/admin.ts` |
| FR8.2 | Must | `backend/src/lib/store.ts` |
| FR8.3 | Must | `backend/src/lib/store.ts` |
| FR9 | Must | `backend/src/lib/data.ts` |
| FR9.1 | Must | `backend/src/lib/data-check.ts` |
| FR9.2 | Must | `backend/src/lib/data.ts` |
| FR12 | Should | `backend/src/lib/hours.ts` |
| FR13 | Should | `backend/src/lib/store.ts` |
| NFR1 | Must | `backend/src/lib/planner.ts` |
| NFR2 | Must | `backend/src/handlers/api.ts` |
| NFR3 | Must | `backend/src/lib/ai.ts` |
| NFR4 | Must | `infra/lib/jarvel-stack.ts` |
| NFR5 | Must | `backend/src/lib/ai.ts` |
| NFR6 | Must | `backend/src/lib/log.ts` |
| NFR7 | Must | `backend/src/handlers/api.ts` |
| NFR8 | Must | `backend/src/lib/log.ts` |
| NFR9 | Must | `backend/src/lib/ai.ts` |
| NFR10 | Must | `backend/vitest.config.ts` |

## Covered Acceptance Criteria

Each row lists the acceptance criteria whose `OK` target is that file.

| Target file | Acceptance criteria |
|---|---|
| `infra/lib/jarvel-stack.ts` | AC1.1.1, AC1.1.2, AC1.1.3, AC1.1.4 |
| `infra/test/jarvel-stack.test.ts` | AC1.2.3, AC6.5.2, AC6.5.3 |
| `backend/test/api.test.ts` | AC1.2.1, AC1.2.2, AC1.2.4, AC1.3.1, AC1.3.2, AC1.3.3, AC2.1.1, AC2.1.2, AC2.1.3, AC2.2.3, AC2.2.5, AC2.3.3, AC3.1.1, AC5.1.2, AC5.2.3, AC5.3.1, AC5.3.3, AC6.4.4, AC7.4.2 |
| `backend/test/schemas.test.ts` | AC2.2.1, AC2.2.2, AC2.2.4 |
| `backend/test/idempotency.test.ts` | AC2.3.1, AC2.3.2 |
| `backend/test/quota.test.ts` | AC2.4.1, AC2.4.2, AC2.4.3, AC2.4.4, AC2.5.3, AC2.5.4 |
| `backend/test/planner.test.ts` | AC2.5.1, AC2.5.2, AC3.2.1, AC3.2.3, AC4.4.3, AC5.1.1, AC6.5.1 |
| `backend/test/store.test.ts` | AC3.1.2, AC3.1.3, AC5.3.2, AC5.4.1, AC5.4.2, AC7.4.1 |
| `backend/test/ai.test.ts` | AC3.3.1, AC3.3.2, AC3.3.3 |
| `backend/test/scheduler.test.ts` | AC4.1.1, AC4.1.2, AC4.1.3, AC4.1.4, AC4.2.1, AC4.2.2, AC4.2.3, AC4.4.2, AC4.5.1, AC4.5.2, AC4.7.2, AC7.3.1, AC7.3.2 |
| `backend/test/sun.test.ts` | AC4.1.5 |
| `backend/test/safety.test.ts` | AC4.3.1, AC4.3.2, AC4.3.3, AC4.3.4, AC4.3.5 |
| `backend/test/validator.test.ts` | AC4.4.1, AC4.4.4, AC4.7.3 |
| `backend/test/router.test.ts` | AC4.6.1, AC4.6.2, AC4.6.3, AC4.7.1 |
| `backend/test/markdown.test.ts` | AC5.1.3, AC5.2.1, AC5.2.2 |
| `backend/test/admin.test.ts` | AC6.1.1, AC6.1.2, AC6.1.3, AC6.2.1, AC6.2.2, AC6.3.1, AC6.3.2 |
| `backend/test/data-check.test.ts` | AC6.4.1, AC6.4.2 |
| `backend/test/data.test.ts` | AC6.4.3 |

That is 92 acceptance criteria covered and 12 not covered (AC3.2.2 and the 11 Should criteria above), 104 in all.
