## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-11
**Iteration:** 2

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | backend/scripts/admin.ts > deleteAccount; backend/src/handlers/api.ts > userIdOf | `delete-account` removes plans, idempotency keys and quota items, then deletes the Cognito user. ApiFn trusts any JWT that API Gateway has already verified, and the authorizer does not check revocation. The deleted person's access token therefore stays valid for up to 1 hour. A POST /plans in that window writes new PLAN#, IDEM# and QUOTA# items under the deleted sub, with a plan TTL of departure plus 90 days. This contradicts AC6.3.1 and AC6.3.2 ("storage searched for that person's id, nothing found"). The cleanup is not repeatable because `subOf` needs the Cognito user, which is gone. | Make the sweep re-runnable by sub after tokens expire (for example a `purge-sub <sub>` command or a documented second pass at least 1 hour later). Alternatively write a short-lived `DELETED#<sub>` marker that ApiFn checks before it creates anything. Add a test that a request after deletion leaves nothing behind. | Resolved (reviewer) |
| R-02 | Major | backend/src/lib/planner.ts > failPlan | The transition to FAILED and the quota refund are two separate writes. Only the caller that wins the transition refunds. If `quota.refund` throws after the transition (a transient DynamoDB error), the plan stays FAILED and the count is never given back. The lazy-FAILED path will not retry, because the status is no longer QUEUED or RUNNING. PlannerFn has retryAttempts 0, so nothing retries it either. This breaks FR6.1 and AC2.5.1/2.5.2 under a plausible fault, and the monthly limit is exactly the cost control for this product. | Make the refund recoverable: do the transition and the refund in one TransactWriteItems, or record a `refunded` flag and retry the refund on the next read, or retry the refund with backoff before giving up. Add a test where the refund call throws once. | Resolved (reviewer) |
| R-03 | Minor | backend/src/handlers/api.ts > createPlan (idempotency replay, lines 97-105) | If the original request died after it claimed the key but before the plan was stored, or the user deleted that plan, every retry with the same key gets 409 `request-in-progress` for 24 hours. `claim` also returns `conflict` with the wrong message when the claim was released in between. | On replay with no plan found, take over the claim if it is older than a short grace period, or return a retryable status. Tell the client to use a new key. | Resolved (reviewer) |
| R-04 | Minor | backend/src/lib/quota.ts > holdForDeletedAccount | The QueryCommand over QUOTA# items has no pagination. The risk is low because only a few months of items exist. | Loop on LastEvaluatedKey, as `store.listKeys` already does. | Resolved (reviewer) |
| R-05 | Minor | backend/test coverage (api.ts lines 100, 140-142; planner handler wiring) | The refund-and-release path when `createPlan` throws (api.ts 140-142) has no test, and neither does the replay-with-missing-plan branch. Both are quota-correctness paths. Total line coverage is 95%, so the 80% floor holds. | Add two api.test.ts cases: store.createPlan rejects (expect refund and key release), and replay when the plan is missing (expect 409). | Resolved (reviewer) |
| R-06 | Minor | backend/src/lib/schemas.ts > withDefaults | When the caller gives `nearestStationId` without `walkMinutesToStation`, the walk minutes are taken from the geometrically nearest station, not the named one. The walk to the named station is then wrong, and routing and safety use it. | Compute the walk minutes for the named station, or require both fields together. | Resolved (reviewer) |
| R-07 | Minor | backend/src/lib/store.ts > DELETED_MARKER_DAYS and markAccountDeleted | The marker is keyed by the deleted `sub` for 30 days, although a token lives at most 1 hour. During that time a search of storage for the id finds one item, which AC6.3.2 says should find nothing. The limitation is disclosed in code-summary.md. | Shorten the marker lifetime to a few hours beyond token expiry, or get the builder's explicit acceptance of the disclosed deviation. | Unresolved |
| R-08 | Minor | backend/src/lib/store.ts > markAccountDeleted / code-summary.md "Race at deletion time" | A request that passes the marker check just before the marker is written can still write a plan after deletion. `delete-account --sub` cleans it up, and the summary discloses this. | None needed now. Optionally record the race as an accepted risk at the gate. | Unresolved |
| R-09 | Minor | backend/scripts/dev-server.ts > createServer(...).listen(PORT) | The dev server listens on all network interfaces and sends `access-control-allow-origin: *`. It accepts any `Bearer dev-<name>` token. The data is in memory only and the server cannot reach AWS, so the risk is low, but anyone on the same network can use it while it runs. | Bind to 127.0.0.1 (`listen(PORT, '127.0.0.1')`). | New |
| R-10 | Minor | backend/src/lib/store.ts > renamePlan | The rename condition is only `attribute_exists(sk)`. A plan past its `expiresAt` that DynamoDB has not yet removed can still be renamed, although get and list treat it as gone. The doc comment says "unexpired". | Add `AND (attribute_not_exists(expiresAt) OR expiresAt > :now)` to the condition, or correct the comment. | New |

> R-07 Reviewer note: The deleted-account marker still lives 30 days (DELETED_MARKER_DAYS = 30) although tokens last at most 1 hour. The deviation is disclosed in the code summary. Not blocking.

> R-08 Reviewer note: A request that passes the marker check just before the marker is written can still write a plan after deletion. It is disclosed, and `delete-account --sub` cleans it up. Record it as an accepted risk at the gate.

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| npm run typecheck | PASS | No type errors in any workspace. |
| npm run lint | PASS | No lint errors. |
| npm run format:check | PASS | All files match Prettier. |
| npm run validate:data | PASS | Boston data OK (12 places, 21 stations, 10 safety areas). The output warns the data is unverified sample data. |
| npm test | PASS | All workspaces pass. Backend coverage is 98% (the floor is 80%). Frontend: 6 tests pass. |
| cdk synth (local) | PASS | The stack synthesizes. |

Differential checks on the Nov 3 additions:
- Owner scoping: `listPlans` and `renamePlan` build the key from the signed-in user's `sub`, so a caller cannot reach another user's plans.
- IAM: `dynamodb:Query` is granted only on the plan table's ARN, in the same statement as the other table actions.
- CORS: the API allows any origin with bearer tokens and no cookies, which fits the design.
- Dev server: it imports a test fixture, so nothing from it ships in the Lambda bundle. It uses a fake in-memory table and a scripted model, with no AWS clients.

### Summary

No Critical or Major findings. The checks pass, and the new list and rename routes are scoped to the owner. R-07 and R-08 are disclosed Minor deviations that do not block approval. Binding the dev server to localhost and checking expiry on rename are optional cleanups.
