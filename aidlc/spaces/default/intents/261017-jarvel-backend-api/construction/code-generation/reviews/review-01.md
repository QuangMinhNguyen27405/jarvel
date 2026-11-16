## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-23T17:47:36Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | backend/scripts/admin.ts > deleteAccount; backend/src/handlers/api.ts > userIdOf | `delete-account` removes plans, idempotency keys and quota items, then deletes the Cognito user. ApiFn trusts any JWT that API Gateway has already verified, and the authorizer does not check revocation. The deleted person's access token therefore stays valid for up to 1 hour. A POST /plans in that window writes new PLAN#, IDEM# and QUOTA# items under the deleted sub, with a plan TTL of departure plus 90 days. This contradicts AC6.3.1 and AC6.3.2 ("storage searched for that person's id, nothing found"). The cleanup is not repeatable because `subOf` needs the Cognito user, which is gone. | Make the sweep re-runnable by sub after tokens expire (for example a `purge-sub <sub>` command or a documented second pass at least 1 hour later). Alternatively write a short-lived `DELETED#<sub>` marker that ApiFn checks before it creates anything. Add a test that a request after deletion leaves nothing behind. | New |
| R-02 | Major | backend/src/lib/planner.ts > failPlan | The transition to FAILED and the quota refund are two separate writes. Only the caller that wins the transition refunds. If `quota.refund` throws after the transition (a transient DynamoDB error), the plan stays FAILED and the count is never given back. The lazy-FAILED path will not retry, because the status is no longer QUEUED or RUNNING. PlannerFn has retryAttempts 0, so nothing retries it either. This breaks FR6.1 and AC2.5.1/2.5.2 under a plausible fault, and the monthly limit is exactly the cost control for this product. | Make the refund recoverable: do the transition and the refund in one TransactWriteItems, or record a `refunded` flag and retry the refund on the next read, or retry the refund with backoff before giving up. Add a test where the refund call throws once. | New |
| R-03 | Minor | backend/src/handlers/api.ts > createPlan (idempotency replay, lines 97-105) | If the original request died after it claimed the key but before the plan was stored, or the user deleted that plan, every retry with the same key gets 409 `request-in-progress` for 24 hours. `claim` also returns `conflict` with the wrong message when the claim was released in between. | On replay with no plan found, take over the claim if it is older than a short grace period, or return a retryable status. Tell the client to use a new key. | New |
| R-04 | Minor | backend/src/lib/quota.ts > holdForDeletedAccount | The QueryCommand over QUOTA# items has no pagination. The risk is low because only a few months of items exist. | Loop on LastEvaluatedKey, as `store.listKeys` already does. | New |
| R-05 | Minor | backend/test coverage (api.ts lines 100, 140-142; planner handler wiring) | The refund-and-release path when `createPlan` throws (api.ts 140-142) has no test, and neither does the replay-with-missing-plan branch. Both are quota-correctness paths. Total line coverage is 95%, so the 80% floor holds. | Add two api.test.ts cases: store.createPlan rejects (expect refund and key release), and replay when the plan is missing (expect 409). | New |
| R-06 | Minor | backend/src/lib/schemas.ts > withDefaults | When the caller gives `nearestStationId` without `walkMinutesToStation`, the walk minutes are taken from the geometrically nearest station, not the named one. The walk to the named station is then wrong, and routing and safety use it. | Compute the walk minutes for the named station, or require both fields together. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| npm run typecheck | PASS (shared, backend, infra) | Clean. |
| npm run lint | PASS | Clean. |
| npm run format:check | PASS | Clean. |
| npm run validate:data | PASS with the SAMPLE-data warning | Expected; the plan carries the sample-data warning to travelers. |
| npm test | PASS: backend 175 tests, infra 14 tests; backend line coverage 95.3%, infra 98.3% | The 80% floor is met. Gaps are listed in the Minor coverage finding above. |

### Summary

The build is implementable and sound against the approved plan. Typecheck, lint, format and tests all pass. Quota reservation is one conditional update, there are no refunds on delete, and status transitions are guarded. Plan routes are scoped by JWT `sub`. IAM is least privilege, self sign-up is off, and the AI call is injection-hardened. Two Major gaps remain, which is within the READY allowance: the account-delete token window (AC6.3.2) and the non-recoverable refund after a FAILED transition (FR6.1). Both should be fixed before real users are invited.
