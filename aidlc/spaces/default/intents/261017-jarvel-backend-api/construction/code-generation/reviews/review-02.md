## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-27T15:35:20Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | backend/scripts/admin.ts > deleteAccount; backend/src/handlers/api.ts > userIdOf | `delete-account` removes plans, idempotency keys and quota items, then deletes the Cognito user. ApiFn trusts any JWT that API Gateway has already verified, and the authorizer does not check revocation. The deleted person's access token therefore stays valid for up to 1 hour. A POST /plans in that window writes new PLAN#, IDEM# and QUOTA# items under the deleted sub, with a plan TTL of departure plus 90 days. This contradicts AC6.3.1 and AC6.3.2 ("storage searched for that person's id, nothing found"). The cleanup is not repeatable because `subOf` needs the Cognito user, which is gone. | Make the sweep re-runnable by sub after tokens expire (for example a `purge-sub <sub>` command or a documented second pass at least 1 hour later). Alternatively write a short-lived `DELETED#<sub>` marker that ApiFn checks before it creates anything. Add a test that a request after deletion leaves nothing behind. | Resolved (reviewer) |
| R-02 | Major | backend/src/lib/planner.ts > failPlan | The transition to FAILED and the quota refund are two separate writes. Only the caller that wins the transition refunds. If `quota.refund` throws after the transition (a transient DynamoDB error), the plan stays FAILED and the count is never given back. The lazy-FAILED path will not retry, because the status is no longer QUEUED or RUNNING. PlannerFn has retryAttempts 0, so nothing retries it either. This breaks FR6.1 and AC2.5.1/2.5.2 under a plausible fault, and the monthly limit is exactly the cost control for this product. | Make the refund recoverable: do the transition and the refund in one TransactWriteItems, or record a `refunded` flag and retry the refund on the next read, or retry the refund with backoff before giving up. Add a test where the refund call throws once. | Resolved (reviewer) |
| R-03 | Minor | backend/src/handlers/api.ts > createPlan (idempotency replay, lines 97-105) | If the original request died after it claimed the key but before the plan was stored, or the user deleted that plan, every retry with the same key gets 409 `request-in-progress` for 24 hours. `claim` also returns `conflict` with the wrong message when the claim was released in between. | On replay with no plan found, take over the claim if it is older than a short grace period, or return a retryable status. Tell the client to use a new key. | Unresolved |
| R-04 | Minor | backend/src/lib/quota.ts > holdForDeletedAccount | The QueryCommand over QUOTA# items has no pagination. The risk is low because only a few months of items exist. | Loop on LastEvaluatedKey, as `store.listKeys` already does. | Resolved (reviewer) |
| R-05 | Minor | backend/test coverage (api.ts lines 100, 140-142; planner handler wiring) | The refund-and-release path when `createPlan` throws (api.ts 140-142) has no test, and neither does the replay-with-missing-plan branch. Both are quota-correctness paths. Total line coverage is 95%, so the 80% floor holds. | Add two api.test.ts cases: store.createPlan rejects (expect refund and key release), and replay when the plan is missing (expect 409). | Resolved (reviewer) |
| R-06 | Minor | backend/src/lib/schemas.ts > withDefaults | When the caller gives `nearestStationId` without `walkMinutesToStation`, the walk minutes are taken from the geometrically nearest station, not the named one. The walk to the named station is then wrong, and routing and safety use it. | Compute the walk minutes for the named station, or require both fields together. | Resolved (reviewer) |
| R-07 | Minor | backend/src/lib/store.ts > DELETED_MARKER_DAYS and markAccountDeleted | The marker is keyed by the deleted `sub` for 30 days, although a token lives at most 1 hour. During that time a search of storage for the id finds one item, which AC6.3.2 says should find nothing. The limitation is disclosed in code-summary.md. | Shorten the marker lifetime to a few hours beyond token expiry, or get the builder's explicit acceptance of the disclosed deviation. | New |

> R-01 Reviewer note: `delete-account` writes a DELETED marker (30-day TTL, no email) first. `ApiFn` checks it with a consistent read before any route and answers 401 without writing. `delete-account --sub` re-runs the sweep of plans, keys and quota items. Tests in api.test.ts and admin.test.ts cover refusal, re-run and the live-user case. The residual race at deletion time is disclosed in code-summary.md and is covered by the re-run.

> R-02 Reviewer note: `failPlan` and the lazy-FAILED path now use `QuotaStore.refundWithTransition`, a single TransactWriteItems that holds the status condition and the refund. If it throws, both writes are undone, so the plan is still QUEUED or RUNNING and the overdue check retries it on the next read. The tests cover exactly-once refund, a failed transaction leaving both unchanged, a race, and conflict retries.

> R-03 Reviewer note: The main case is fixed: a settled claim whose plan is missing is taken over with a guarded write. What remains is that `claim` returns `conflict` (409 `idempotency-conflict`) when the key vanished between the failed put and the read. That message is wrong, but it is rare and self-corrects on retry.

> R-04 Reviewer note: `quotaItems` loops on `LastEvaluatedKey`, and a test covers multiple pages.

> R-05 Reviewer note: api.test.ts now covers `createPlan` throwing (refund and key release) and the replay branch with a missing or deleted plan.

> R-06 Reviewer note: `withDefaults` computes the walk time to the named station, and a schemas test covers it.

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| npm run typecheck | PASS | No type errors. |
| npm run lint | PASS | No lint errors. |
| npm run format:check | PASS | All files match Prettier. |
| npm run validate:data | PASS | 12 places, 21 stations, 10 safety areas. The output warns the data is unchecked sample data, which is a known limit. |
| npm test | PASS | Backend line coverage 95.85% and infra 98.3%, both above the 80% floor. Infra 14 of 14 tests passed. |

### Summary

Both Major findings are fixed with tests that exercise real conditional-write and transaction behavior: the deleted-account marker with a re-runnable sweep by `sub`, and an atomic status change plus refund. Only Minor items remain, so the build is ready.
