# Code Generation Plan: Jarvel Backend API (Nov 18 must-haves)

## Summary

- Builds: the invite-only Boston planning API and its AWS stack, the web app with a map of each day, and (Step 15, Nov 12) a local demo account whose trip is built from your own places, with every stop inside its opening hours
- Touches: `shared/src/`, `backend/` (src, scripts, test, data), `infra/` (bin, lib, test), `frontend/src/`, root tooling config
- Tests: the existing 264 Vitest tests stay green apart from expectations that opening hours change; Step 15 adds about 30 (place matching, opening hours, the demo account, the web app's demo sign-in and "Not scheduled" list), with AWS and AI faked and an 80% line-coverage threshold

## Context and Scope

The design stages (Domain Design, Units Generation, Contract Design, Functional/NFR/Infrastructure Design) were skipped at your request. So this plan is the only design record, and **approving it confirms the design decisions below**. They draw on `docs/ARCHITECTURE.md` as context only; nothing from that document is carried over unless it is listed here.

Built from:
- `inception/requirements-analysis/requirements.md`: FR1–FR9, NFR1–NFR10.
- `inception/user-stories/stories.md`: all 27 Must stories (US1.1–US6.5).
- `inception/practices-discovery/team-practices.md`.

The Should stories (US7.1–US7.6, FR10–FR15) are **not** in this plan. This is one build for the whole backend: there are no Units, because Units Generation was skipped.

Not in this plan:
- The GitHub Actions workflow (the CI Pipeline stage).
- The staging and production deploy pipeline and the real deploy (the Operation stages).

## Design Decisions (confirmed by approving this plan)

| # | Decision | Why | Alternative not taken |
|---|----------|-----|-----------------------|
| D1 | **AWS serverless in us-east-1.** API Gateway HTTP API with a Cognito JWT authorizer, one `ApiFn` Lambda for all routes, one `PlannerFn` Lambda that builds a plan, and DynamoDB on-demand. Node 22, arm64. | Pay-per-use fits under $25 a month (C-03). The Region is in the US (C-11). It is the existing account and SDK choice (C-07). | Containers on ECS/App Runner, which bill per hour even when idle. |
| D2 | **Plans are built asynchronously by invoking `PlannerFn` from `ApiFn`.** No Step Functions. `PlannerFn` stops itself at 4 min 30 s and marks the plan `FAILED`. On read, a plan still `QUEUED` or `RUNNING` more than 5 minutes after it was accepted is shown as `FAILED`, and its count is given back. | This is the simplest way to meet FR2.3 and FR2.5 inside about 45 hours. | A multi-agent Step Functions pipeline (6 agents), which has more AI calls, more cost and more build time. |
| D3 | **One AI call per plan, then fixed rules.** Bedrock Converse is asked once to choose and order the stops for each day. Its answer is checked with zod and retried at most twice (NFR9). Code then assigns times, routes transit, applies the safety and last-train rules, and moves any stop it cannot place safely to "unscheduled" with a reason. A final fixed-rule validator checks the finished plan before it is saved as `SUCCEEDED` (FR4.3). | "Zero safety rules broken" cannot depend on the model. One call keeps cost at about $0.10 per plan or less. | Letting the AI write the times, with the AI also critiquing its own plan. |
| D4 | **The AI model ID comes from configuration** (CDK context `modelId`, Lambda environment variable `MODEL_ID`). The default is a Claude Haiku-class model through a US cross-region inference profile. Cost per plan is computed from the token counts the Converse response returns. | Keeps per-plan cost low (A-1); the model can change without code changes. | A hardcoded model. |
| D5 | **DynamoDB has a single table** keyed `pk = USER#<sub>`, `sk = PLAN#<planId>` / `QUOTA#<YYYY-MM>` / `IDEM#<key>`. The monthly count is changed with a conditional update, so requests sent at the same time cannot get past 3 (FR6.3). Plan items carry `expiresAt` (departure + 90 days) as a DynamoDB TTL (FR8.2). The finished plan is stored inline. | One table, no S3. Atomic quota updates, and retention at no cost. | A separate S3 store for plans, which is not needed under DynamoDB's 400 KB item size. |
| D6 | **Count refunds:** a plan that ends `FAILED` because of a timeout, an AI error, an internal error or "no safe plan possible" gives its count back (FR6.1, user-stories Q6). Deleting a plan never gives it back (FR8.3). Quota items are kept when an account is deleted, so deleting and re-inviting a person does not reset the month. | Confirmed answers. Closes the loophole the stories review raised. | Refunding on delete. |
| D7 | **Idempotency:** the `Idempotency-Key` header is optional. The same key with the same body returns the same plan. The same key with a different body returns 409. With no key, the request is treated as new (FR2.6, AC2.3.x). Keys expire after 24 hours. | Matches the stories. | A required key. |
| D8 | **Sign-in uses a Cognito User Pool:** email as username, self sign-up off, users created only by the admin through `AdminCreateUser` (the temporary password is emailed by Cognito's default sender), Cognito's default password policy, and a 1-hour access token. "Disable" is `AdminDisableUser` plus `AdminUserGlobalSignOut`, so within 1 hour the person's tokens stop working (FR1.6). Admin actions run as a local script under the admin's AWS credentials, with no admin API (A-5). | Fewer than 10 invitations fit Cognito's built-in email limit. | Our own invite emails through SES. |
| D9 | **Routes:** `GET /health` (no auth, no data), `POST /plans`, `GET /plans/{planId}` (JSON by default, Markdown when `?format=markdown` or `Accept: text/markdown`), and `DELETE /plans/{planId}`. Errors are `{ error, code, fields? }`. Every route except `/health` needs a JWT. Plans owned by someone else return 404. There is no `GET /catalog`, `GET /plans` or revise route. | FR1.4, FR1.5, FR7, FR7.1, FR8. The catalog question was open; it is left out to keep the surface small. | Exposing the catalog. |
| D10 | **Boston data** lives in `backend/src/data/{places,transit,safety}.json` with a `version` field. `npm run validate:data` checks references and times and fails on errors (FR9, FR9.1). The repository gets a **small sample dataset marked `verified: false`**: a handful of stations on the Blue, Orange, Red and Green lines, about 12 places and about 8 safety areas. It is used by tests and the first deploy, and **you replace it with your hand-checked data** (approval-handoff Q3). The sample is clearly labelled and is not presented as checked safety information. | Code cannot make up real safety facts. | Generating "real" Boston safety data. |
| D11 | **Sunset** is computed in code (NOAA solar position formula) for Boston's coordinates on each date (A-3). | No data file to maintain. | A table of sunset times. |
| D12 | **Observability:** each plan stores its duration and AI cost. Lambdas log in JSON with no emails or tokens (NFR6). CloudWatch alarms watch API 5xx responses and a `PlansFailed` metric (emitted in CloudWatch embedded metric format). An AWS Budget emails the admin at $20 (NFR3, NFR8). Log retention is 2 weeks. | Cheap, and meets NFR3 and NFR8. | X-Ray tracing, which is extra cost and not required. |
| D13 | **Environments:** one CDK stack, parameterised by a `stage` context value (`staging` or `prod`) and deployed twice to the one account. `infra` drops `--require-approval never`. The root `synth` and `deploy` scripts no longer build the frontend. | Team Deployment practice; the web app is out of scope. | Separate accounts. |

## Testing Contract

```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "team",
  "ordering": "Implement each testable layer first, then write and run that layer's tests before moving on to the next layer.",
  "scope": "express",
  "test_strategy": "minimal",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: test-after\n- **Methodology evidence**: The builder chose test-after in the practices-discovery interview (Q3, option A). The repository has no tests yet, so there was no existing habit to keep or replace. Vitest is already declared in `backend`, `infra` and `frontend`.\n- **Ordering**: Implement each testable layer first, then write and run that layer's tests before moving on to the next layer.\n- Coverage floor: at least 80% line coverage, checked in CI before a pull request can merge.\n- Test volume and types follow the intent's Test Strategy (Standard).\n- Test runner: Vitest in every package that has code. Coverage reports go to `coverage/`, which git ignores.\n- The automated test suite uses fakes for every paid AWS service and for the AI model, so test runs cost nothing against the $25-per-month cap.\n- The only check against real AWS is a short smoke check against the real deployment after each deploy.\n- The type check (`npm run typecheck`) and the test suite (`npm test`) both have to pass. Today both fail (no workspace `tsconfig.json`, no test files), so Construction first makes them pass to set a baseline.\n- Frontend test tooling (jsdom, Testing Library) is declared but not used in this version, because the traveler web app is out of scope."
    },
    {
      "layer": "project",
      "text": "- Test database code against a small in-memory table behind aws-sdk-client-mock that applies the real condition and update expressions, not canned responses per test, so concurrency and status-transition tests check real conditional-write behavior. (learned 2026-10-26)"
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:a90ed08702f3d25203fd76508ae42375bdba2032bb74ef64e26925370959eaf5",
  "contract_sha256": "sha256:35750dfefdd52cad32699bab3c539d716261794f57621a73f92c4e58ec27e887"
}
```

## Steps

The layers follow the contract's test-after order. There is no frontend layer: the web app is out of scope (requirements Q5).

### Step 1: Project structure and production configuration skeleton
- [ ] Add `tsconfig.json` to `shared`, `backend` and `infra`, each extending `../tsconfig.base.json` (so TS5058 goes away). Add `@jarvel/shared` as a dependency of `backend` and `infra` (project rule: ALWAYS declare it).
- [ ] Root: `.prettierrc.json` (single quotes, semicolons, width 120), `.prettierignore`, `eslint.config.js` (typescript-eslint recommended), and root scripts `lint`, `format:check`, `validate:data`. Add dev dependencies `prettier`, `eslint`, `typescript-eslint`, `@vitest/coverage-v8` and `aws-sdk-client-mock`.
- [ ] Remove `--require-approval never` from `infra`'s `deploy` script. Root `synth` and `deploy` no longer run `build:frontend`. Add `cdk-outputs.json` to `.gitignore` (project rule: NEVER commit deploy outputs).
- [ ] `shared/src/types.ts`: add `ApiErrorBody { error; code; fields? }` and `QuotaExceededBody { limit; used; resetsOn }`. Add `PlanFailureKind = 'timeout' | 'ai-error' | 'internal' | 'no-safe-plan'`. Add `dataVersion`, `sourceCredits`, `aiCostUSD`, `durationMs`, `acceptedAt` and `failureKind?` to `PlanRecord`, and `disclaimer` to `Itinerary`. Revise and `FrontendConfig` stay in place but unused (A-6). Stories: US2.2, US2.4, US3.2, US4.5, US5.1.

### Step 2: Verify the test runner and record the exact command
- [ ] `backend/vitest.config.ts` and `infra/vitest.config.ts` with v8 coverage, reporting to `coverage/` with an 80% line threshold. Runner check: `npx vitest run --root backend test/smoke.test.ts` with one trivial real assertion about the data loader once Step 3 exists. Record the exact commands in `unit-test-instructions.md`.

### Step 3: Data model — implement (Boston data and request schema)
- [ ] `backend/src/data/places.json`, `transit.json` and `safety.json`: the sample dataset (D10), each with `version` and `sample: true`. Every place has `verified: false`.
- [ ] `backend/src/lib/data.ts`: loads and type-checks the data and exposes `dataVersion` and `sourceCredits` (FR9, FR9.2).
- [ ] `backend/src/lib/data-check.ts` and `backend/scripts/validate-data.ts`: check that every place's station and area exist, that every edge's stations and line exist, that times are valid `HH:MM`, and that ids are unique; exit with code 1 on any error (FR9.1, US6.4).
- [ ] `backend/src/lib/schemas.ts`: zod schema for `TripRequest` with the limits (1–7 days, 1–6 travelers, ≤15 wishlist entries of ≤100 characters, notes ≤1000, arrival in the future and ≤12 months ahead, departure after arrival). It reports every field error, and the hotel must be within a 30-minute walk of a stored station (FR2.1, FR2.2, FR2.7, US2.2).
- [ ] `backend/src/lib/time.ts` (Boston local time, DST-safe date math, `HH:MM` helpers) and `backend/src/lib/sun.ts` (sunset, D11) (FR3.4, FR4.2).

### Step 4: Data model — write and run its tests
- [ ] `backend/test/data.test.ts`, `data-check.test.ts`, `schemas.test.ts`, `time.test.ts` and `sun.test.ts`. They cover:
  - every limit at its value and one step past it (AC2.2.1, AC2.2.2);
  - two bad fields reported in one error (AC2.2.3);
  - a hotel outside the covered area (AC2.2.4);
  - a broken data reference failing the check (AC6.4.1, AC6.4.2);
  - DST-crossing dates (AC4.1.5);
  - sunset on Nov 18 2026 within ±5 minutes of 16:16.
- [ ] Run: `npx vitest run --root backend test/data.test.ts test/data-check.test.ts test/schemas.test.ts test/time.test.ts test/sun.test.ts`.

### Step 5: Repository / data access — implement
- [ ] `backend/src/lib/store.ts`: DynamoDB Document Client wrapper. It covers:
  - `createPlan` (with an `expiresAt` TTL);
  - `getPlan(userId, planId)`, owner-scoped (FR1.5);
  - `updatePlanStatus`, which allows only `QUEUED`→`RUNNING`→`SUCCEEDED`/`FAILED` through a condition expression (FR2.4);
  - `deletePlan` (FR8);
  - `deleteAllForUser`, which keeps quota items (FR8.1, D6).
- [ ] `backend/src/lib/quota.ts`: `monthKey` in Boston time (FR6), atomic `reserve` (conditional `count < 3`), `refund` and `resetsOn` (FR6.1–FR6.3).
- [ ] `backend/src/lib/idempotency.ts`: a key plus a body hash in one item with a 24-hour TTL; mismatch → conflict (FR2.6, D7).

### Step 6: Repository / data access — write and run its tests
- [ ] `backend/test/store.test.ts`, `quota.test.ts` and `idempotency.test.ts`, using `aws-sdk-client-mock`, with no AWS calls. They cover:
  - a 4th request refused (AC2.4.1);
  - the reset at Boston midnight across DST (AC2.4.2, AC2.4.4);
  - 5 requests at once with 2 used → 1 accepted, through a conditional-failure simulation (AC2.4.3);
  - a refund after a failure, and no refund on delete (AC2.5.1–AC2.5.4);
  - an illegal status transition refused (AC3.1.2, AC3.1.3);
  - a key reuse that matches and one that does not (AC2.3.1–AC2.3.3);
  - account deletion keeping the quota (AC6.3.1, AC6.3.2).
- [ ] Run: `npx vitest run --root backend test/store.test.ts test/quota.test.ts test/idempotency.test.ts`.

### Step 7: Business logic — implement
- [ ] `backend/src/lib/router.ts`: Dijkstra over the stored network with walking limits. It respects each line's first and last train and uses headway-based waits; legs come with steps, stations, minutes and fare (FR5, FR5.1, FR5.2, FR5.4).
- [ ] `backend/src/lib/safety.ts`: decides whether an item is allowed in an area at a given time. The rules are avoid-after, elevated night risk after sunset, moderate risk after sunset under strict, and unknown area → daytime only (FR4, FR4.1, FR4.2, FR4.5).
- [ ] `backend/src/lib/ai.ts`: one Bedrock Converse call with a tool-forced JSON answer (zod-validated) that picks and orders stops by day from catalog place ids. The traveler's wishlist and notes are wrapped as delimited data inside the prompt (NFR5). It retries at most twice on invalid output or throttling (NFR9) and returns the token-based cost (NFR3). The model client is injected so tests can fake it.
- [ ] `backend/src/lib/scheduler.ts`: turns the ordered stops into timed days. It covers:
  - day start, back-at-hotel time, the arrival day and the departure day (FR3, FR3.2, FR3.3);
  - inserted transit legs;
  - stops that break a safety or last-train rule, which are moved or dropped to unscheduled with the fixed reasons (FR4.3, FR5.3);
  - wishlist entries that cannot be matched to the data, which are unscheduled as "not in the Boston data" (FR3.1, FR3.5);
  - safety guidance for each day and the disclaimer (FR4.4).
- [ ] `backend/src/lib/validator.ts`: the final fixed-rule check. It looks for overlaps, out-of-window items, safety violations, rides outside service hours, walks over the limit, missing wishlist coverage and unknown place ids. Any violation means the plan is never `SUCCEEDED`; it fails as `no-safe-plan` (FR4.3).
- [ ] `backend/src/lib/planner.ts`: puts it together. It loads the request, marks `RUNNING`, calls the AI, schedules and validates, then saves `SUCCEEDED` with the data version, credits, cost and duration. On failure it saves `FAILED` with a plain reason and refunds the count. A 4 min 30 s internal deadline applies (FR2.5, D2).
- [ ] `backend/src/lib/markdown.ts`: renders the plan as Markdown with days, items, legs, safety guidance, disclaimer, unscheduled list, data version and credits. An unfinished plan renders as its status (FR7.1).

### Step 8: Business logic — write and run its tests
- [ ] `backend/test/router.test.ts`, `safety.test.ts`, `ai.test.ts`, `scheduler.test.ts`, `validator.test.ts`, `planner.test.ts` and `markdown.test.ts`, with a fake model client only. They cover:
  - 4 days for Nov 18 10:00–Nov 21 15:00 with no overlaps (AC4.1.1–AC4.1.4);
  - wishlist coverage and "not in the Boston data" (AC4.2.1–AC4.2.3);
  - avoid-after, elevated after sunset, strict moderate, unknown area (AC4.3.1–AC4.3.5);
  - an AI answer that breaks a safety rule never becomes `SUCCEEDED` (AC4.4.1, AC4.4.2, AC4.4.4);
  - "ignore safety rules" in notes (AC4.4.3);
  - disclaimer and guidance present (AC4.5.1, AC4.5.2);
  - legs, the walking limit and recomputed times (AC4.6.1–AC4.6.3);
  - the last-train rearrangement or unscheduling, and no impossible ride (AC4.7.1–AC4.7.3);
  - invalid AI output twice then good → `SUCCEEDED` with one count, three times → `FAILED` with the count refunded, and output checked against its schema (AC3.3.1–AC3.3.3);
  - the deadline marks `FAILED` with a plain reason (AC3.2.1, AC3.2.3);
  - Markdown containing every JSON stop and leg, and a status-only render for unfinished plans (AC5.2.1–AC5.2.3).
- [ ] Run: `npx vitest run --root backend test/router.test.ts test/safety.test.ts test/ai.test.ts test/scheduler.test.ts test/validator.test.ts test/planner.test.ts test/markdown.test.ts`.

### Step 9: API / endpoint — implement
- [ ] `backend/src/lib/http.ts`: JSON and Markdown responses, the error body, and no internal details in 5xx bodies.
- [ ] `backend/src/handlers/api.ts`: routes by `routeKey` (D9) and reads `userId` from the JWT `sub`. Behaviour by route:
  - `POST /plans`: validate → idempotency → quota reserve → create `QUEUED` → async-invoke `PlannerFn` → 202 `{ planId, version, status }` (FR2, FR2.3).
  - `GET /plans/{id}`: returns JSON or Markdown, and applies the lazy 5-minute `FAILED` with refund (FR7, FR7.1, D2).
  - `DELETE /plans/{id}`: returns 204, or 404 when the plan is not the caller's.
  - `/health`: returns status only.
  - Logs contain no email.
- [ ] `backend/src/handlers/planner.ts`: the Lambda entry point that calls `planner.ts`.
- [ ] `backend/scripts/admin.ts`: `invite <email>`, `disable <email>` (disable + global sign-out) and `delete-account <email>` (removes the Cognito user and all of their plans and idempotency items). It reads the pool id and table name from environment variables and rejects a duplicate invite (FR1.1, FR1.6, FR8.1, AC6.1.1–AC6.1.3, AC6.2.x, AC6.3.x).

### Step 10: API / endpoint — write and run its tests
- [ ] `backend/test/api.test.ts` (integration-style: handler with faked DynamoDB and Lambda clients) and `backend/test/admin.test.ts` (faked Cognito). They cover:
  - 401 without claims and the health check without data (AC1.2.1, AC1.2.2, AC1.2.4);
  - another person's plan → 404 on GET and DELETE (AC1.3.1–AC1.3.3);
  - 202 with `QUEUED` and the request stored as sent (AC2.1.1–AC2.1.3);
  - 400 naming fields, with the count unchanged (AC2.2.3, AC2.2.5);
  - 429 body with limit, used and reset date (AC2.4.1);
  - Idempotency-Key replay and 409 conflict (AC2.3.1, AC2.3.2);
  - Markdown via the query and via `Accept` (AC5.2.1);
  - the lazy timeout (AC3.2.1);
  - delete → 404 afterwards (AC5.3.1–AC5.3.3);
  - admin invite, duplicate invite, disable and delete-account (AC6.1.x, AC6.2.x, AC6.3.x).
- [ ] Run: `npx vitest run --root backend test/api.test.ts test/admin.test.ts`.

### Step 11: Environment and build configuration (infrastructure)
- [ ] `infra/cdk.json`, `infra/bin/jarvel.ts`, `infra/lib/jarvel-stack.ts`. The stack contains:
  - Cognito User Pool (self sign-up off, email username, default password policy, 1-hour access token) and a public app client using SRP;
  - HTTP API with a JWT authorizer on every route except `/health`;
  - `ApiFn` and `PlannerFn` as `NodejsFunction`, arm64, Node 22, with 2-week log retention; `PlannerFn` has a 5-minute timeout and asynchronous retry attempts set to 0;
  - DynamoDB table (on-demand, TTL on `expiresAt`, point-in-time recovery, encrypted);
  - IAM with no wildcard data actions: `ApiFn` gets read/write on the table plus `lambda:InvokeFunction` on `PlannerFn` only; `PlannerFn` gets read/write on the table plus `bedrock:InvokeModel` and `bedrock:Converse` on the configured profile and model ARNs only;
  - a stage throttle of 5 requests per second;
  - alarms on API 5xx and `PlansFailed`;
  - an AWS Budget of $25 a month with an $20 email alert to `alertEmail` (CDK context);
  - outputs `ApiUrl`, `UserPoolId`, `UserPoolClientId` and `TableName`.
  
  Stories: US1.2, US6.5; NFR3, NFR4, NFR6, NFR7, NFR8.
- [ ] `infra/test/jarvel-stack.test.ts`, using CDK `Template` assertions. It checks:
  - self sign-up is off and the token validity is 1 hour;
  - every route except `/health` has the authorizer;
  - the table has TTL and encryption;
  - there is no `*` resource on DynamoDB or Bedrock actions;
  - both alarms exist;
  - the budget alert is at $20;
  - the Region is us-east-1.
- [ ] Run: `npx vitest run --root infra test/jarvel-stack.test.ts`.

### Step 12: Documentation and traceability
- [ ] `backend/README.md`: covers
  - the endpoints with curl examples;
  - the admin script usage;
  - how to replace the sample Boston data and run `npm run validate:data`;
  - the cost model and the meaning of `MODEL_ID`;
  - the post-deploy smoke check (health → sign in → create plan → poll → read Markdown);
  - rollback (redeploy the previous commit).
- [ ] Confirm `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run validate:data` and `npm test` all pass from the repository root, with line coverage of at least 80% in `backend` and `infra`. If coverage falls short, add tests; never lower the threshold.

### Step 13: Revision — fix the architecture review's findings
These fix what the architecture review found in the finished build. Each is a test-after change: implement, then write and run its tests.
- [ ] **Deleted accounts cannot create plans afterwards (AC6.3.1, AC6.3.2, FR8.1).** `delete-account` in `backend/scripts/admin.ts` writes a `DELETED` marker item for the user's `sub` (pk `USER#<sub>`, sk `DELETED`, holding no email) before it removes the user's items and the Cognito user. `backend/src/handlers/api.ts` refuses any plan route for a `sub` with that marker (401, no item written). The cleanup can also be re-run by `sub` (`delete-account --sub <sub>`), so items written before the marker are removed too. Tests in `backend/test/admin.test.ts` and `backend/test/api.test.ts`: a request after deletion is refused and writes nothing; a re-run by `sub` removes leftover items; a live user is unaffected.
- [ ] **A failed plan's refund cannot be lost (FR6.1, AC2.5.1, AC2.5.2).** `failPlan` in `backend/src/lib/planner.ts` and the lazy-`FAILED` path in `backend/src/handlers/api.ts` mark the plan `FAILED` and give back the monthly count in one DynamoDB `TransactWriteItems` (the status condition and the refund together), so either both happen or neither does, and a plan is still never refunded twice. Add `TransactWriteItems` to the in-memory test table. IAM has no separate permission for a transaction (each write in it is checked against the item action it uses, here `UpdateItem`, which both functions already have), so no IAM change is needed. Tests in `backend/test/planner.test.ts` and `backend/test/quota.test.ts`: a failure refunds exactly once; a failed transaction leaves both the status and the count unchanged; two callers racing to fail the same plan refund once.
- [ ] **Smaller review findings.** An idempotency key whose plan was never stored or was deleted is released, so the retry is treated as new instead of 409 `request-in-progress` for 24 hours (`backend/src/lib/idempotency.ts`, `backend/src/handlers/api.ts`). The quota-hold lookup in `holdForDeletedAccount` reads every page. A hotel given `nearestStationId` without `walkMinutesToStation` gets the walk time to that named station (`backend/src/lib/schemas.ts`). Add the two missing tests: the refund and key release when `createPlan` throws, and the replay branch when the plan is missing.
- [ ] Run `npx vitest run --root backend test/admin.test.ts test/api.test.ts test/planner.test.ts test/quota.test.ts test/idempotency.test.ts test/schemas.test.ts`, then confirm `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run validate:data` and `npm test` all pass from the repository root with line coverage of at least 80% in `backend` and `infra`. Never lower the threshold.

### Step 14: Revision (Nov 12) — finish the discussed features
Your change request: "iterate until you finished all the discussed features so far". Three things discussed are not finished yet:
- the trip map, which you asked for on Nov 3 before putting CRUD first;
- the four open review points R-07 to R-10;
- a run of the web app in a real browser.

Since Nov 3 the build also has the web app and the list and rename routes (see `code-summary.md`). Each change below is test-after: implement it, then write and run its tests.

- [ ] **Trip map (Nov 3 request).**
  - `shared/src/types.ts`: `ItineraryItem` gets an optional `location: { lat: number; lng: number }`.
  - `backend/src/lib/scheduler.ts` sets it on visit and meal items from the place's stored coordinates, and on hotel items from the trip's hotel. Transit items get none. The Markdown output does not change.
  - `frontend/src/map.ts`: a pure helper that lists a day's mapped stops in order, starting and ending at the hotel when the day has it.
  - `frontend/src/TripMap.tsx`: a react-leaflet map with OpenStreetMap tiles and their attribution, a numbered marker for each stop and a line joining them in order. Every day card in the plan view shows its map.
  - Map choice: the map uses Leaflet with OpenStreetMap tiles. Both are already in the web app's dependencies, and they need no API key and cost nothing. Google Maps is not used because it needs an API key tied to a billing account.
  - Tests:
    - `backend/test/scheduler.test.ts`: every visit, meal and hotel item has a location, and transit items have none.
    - `frontend/src/map.test.ts`: covers order, the hotel, items without a location left out, and a day with no stops.
    - `frontend/src/App.test.tsx`: the plan view shows one map per day. react-leaflet is replaced by a stub because jsdom cannot draw maps.
- [ ] **R-10: an expired plan cannot be renamed.**
  - `renamePlan` in `backend/src/lib/store.ts` adds `AND (attribute_not_exists(expiresAt) OR expiresAt > :now)` to its condition, and the API answers 404, as it does for reading the plan.
  - Test in `backend/test/store.test.ts`.
- [ ] **R-07: the deleted-account marker lasts 2 hours, not 30 days.**
  - Access tokens last at most 1 hour, so 2 hours covers them with a margin. After that nothing in storage names the deleted user id (AC6.3.2), apart from DynamoDB's own delay in removing expired items, which can take up to two days.
  - `DELETED_MARKER_DAYS = 30` becomes `DELETED_MARKER_HOURS = 2` in `backend/src/lib/store.ts`. The README and the admin script's message are updated to match.
  - Test in `backend/test/admin.test.ts`.
- [ ] **R-08: nothing is written for an account being deleted, even mid-deletion.**
  - `POST /plans` writes three things: the retry key, the monthly count and the plan. Each write is sent as one `TransactWriteItems` together with a `ConditionCheck` that the user's `DELETED` marker does not exist. A request that passed the earlier marker check therefore cannot write once the marker is in place.
  - When the marker check fails, the API returns the same 401 it returns today. When the write's own condition fails, it means what it does today: limit reached, key in use, or plan already exists.
  - A transaction cannot return the new monthly count, so it is read back after the write.
  - The in-memory test table learns `ConditionCheck`.
  - **IAM change:** `ApiFn` gets `dynamodb:ConditionCheckItem` on the plan table's ARN only. This is security-related infrastructure, so read its CDK diff before any deploy (project rule).
  - Tests:
    - `backend/test/api.test.ts`: a marker written between the API's check and its writes leaves no plan, retry key or count behind and returns 401. A live user is unaffected.
    - `backend/test/quota.test.ts`: five requests at once with two already used still accept exactly one.
    - `infra/test/jarvel-stack.test.ts`: the new action is limited to the table.
- [ ] **R-09: the dev server only accepts connections from this computer.**
  - `backend/scripts/dev-server.ts` listens on `127.0.0.1` by default. A `HOST` environment variable changes that.
  - The server setup moves into an exported function so a test can start it on a free port and check the address.
  - README updated.
  - Test in `backend/test/dev-server.test.ts`.
- [ ] **Run the web app end to end in a browser.**
  - Start the local API (`npm run dev -w @jarvel/backend`) and the web app (`npm run dev -w @jarvel/frontend`).
  - In Chrome, as one local user:
    1. Sign in with a local name.
    2. Create a trip and wait until it is Ready.
    3. Check the days, each day's map and the safety notes.
    4. Rename the trip and check the new title in the list.
    5. Delete it and check it is gone.
  - Check that a second local user does not see the first user's trip.
  - Fix whatever breaks, with a test for each fix, and record what was checked in `code-summary.md`.
  - This uses the local fake sign-in and the scripted planner. Real Cognito sign-in and the real AI model need a deployment, which is not part of this step.
- [ ] Run the Step 14 test commands in `unit-test-instructions.md`. Then confirm from the repository root that these pass: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run validate:data`, `npm test` (at least 80% line coverage in `backend` and `infra`) and `npx cdk synth -c alertEmail=you@example.com -q` (run in `infra`). Never lower the threshold. Update `backend/README.md`, `code-summary.md` and `traceability.json`.

### Step 15: Revision (Nov 12) — a demo account with your own places
Your change request: "Here are the locations I plan to visit. Can you make this the demo, with a demo account. You can use the [email address removed] email", followed by "Iterate, test with playwright mcp, and implement until you verifies there is no error on both frontend and backend side".

Your list, as you wrote it: `Saltie Girl - Lobster Roll`, `Blank Street - Coffee/Matcha`, `Guilia - Italian`, `Quin Long - Malatang Hotpot`, `Sail Loft - Lobster Roll, seafood portofino`, `Mike’s Pastry`, `Zei Wei - Taiwan noodle`.

What this step decides:
- **The demo is local.** It lives on the local server (`npm run dev -w @jarvel/backend`) and costs nothing. Nothing is deployed and nobody is emailed. A real account for the same address on a deployment is still one `admin invite` away, after the first deploy.
- **Six of the seven places were found by a web search on Nov 12** and go into the Boston data as real places with `verified: false`. Their hours and coordinates are not hand-checked.
- **`Quin Long - Malatang Hotpot` was not found** under that name. It is not added as a guess. The demo trip keeps your entry and lists it as not scheduled, with the reason "not in the Boston data", until you say which restaurant it is.
- **Opening hours are pulled in (FR12, US7.3, a Should story).** All of your places are restaurants and cafes. Without this, the planner would put a dinner-only restaurant at 09:20.
- **The hotel is a placeholder** (`My hotel`, the web form's default near State station), because you have not given one for the demo.
- **The demo address is written in one file only**, `backend/scripts/demo.ts`, which is never deployed. The web app learns it from the local server, so the address is not built into the deployable web app or the Lambda code.

Each change below is test-after: implement it, then write and run its tests.

- [ ] **Your places in the Boston data.**
  - `shared/src/types.ts`: `Place` gets an optional `aliases: string[]` (other spellings a traveler may type).
  - `backend/src/lib/data-check.ts` accepts `aliases`. `matchWishlistEntry` in `backend/src/lib/data.ts` also matches an alias: equal to the entry, or contained in it as whole words when the alias has at least five characters. Names and ids are still tried first, and the first place in file order still wins.
  - `backend/src/data/places.json`: version `sample-2026-11-12`, six new places appended after the existing twelve, each with `verified: false`, `userRequested: true`, `matchedFrom` set to your wording, and a `confidenceNote` saying the details come from a web search on 2026-11-12 and are not hand-checked. The file's `notice` and `sourceCredits` say the same. `sample` stays `true`.

    | id | Name | Category (cuisine) | Address | lat, lng | Station, walk | Safety area | Visit | Cost per person | Reservation |
    |---|---|---|---|---|---|---|---|---|---|
    | `saltie-girl` | Saltie Girl | restaurant (Seafood) | 279 Dartmouth St, Boston, MA 02116 | 42.3512, -71.0779 | `copley`, 3 | `back-bay` | 75 min | 45–80, level 3 | recommended |
    | `blank-street-back-bay` | Blank Street Coffee (Back Bay) | coffee | 647 Boylston St, Boston, MA 02116 | 42.3497, -71.0789 | `copley`, 2 | `back-bay` | 25 min | 5–10, level 1 | none |
    | `giulia` | Giulia | restaurant (Italian) | 1682 Massachusetts Ave, Cambridge, MA 02138 | 42.3823, -71.1197 | `harvard`, 13 | `porter-square` | 90 min | 60–100, level 3 | required |
    | `boston-sail-loft` | The Boston Sail Loft | restaurant (Seafood) | 80 Atlantic Ave, Boston, MA 02110 | 42.3627, -71.0506 | `aquarium`, 6 | `waterfront` | 75 min | 30–55, level 2 | none |
    | `mikes-pastry` | Mike's Pastry | bakery | 300 Hanover St, Boston, MA 02113 | 42.3642, -71.0542 | `haymarket`, 6 | `north-end` | 25 min | 6–15, level 1 | none |
    | `zhi-wei-cafe` | Zhi Wei Cafe | restaurant (Chinese, Lanzhou hand-pulled noodles) | 104 South St, Boston, MA 02111 | 42.3512, -71.0572 | `south-station`, 4 | `chinatown` | 50 min | 15–25, level 1 | none |

    Opening hours, aliases and notes:
    - `saltie-girl`: Mon–Wed 11:00–22:00, Thu–Sat 11:00–23:00, Sun 11:00–22:00. Aliases: none needed. `matchedFrom`: `Saltie Girl - Lobster Roll`. Tips: the lobster roll. Source: `https://www.saltiegirl.com/location/saltie-girl-boston`.
    - `blank-street-back-bay`: Mon–Fri 07:00–17:30, Sat 07:00–18:00, Sun 08:00–16:00. `hoursNote`: listings disagree, and the Sunday hours are the least certain. Aliases: `Blank Street`. `matchedFrom`: `Blank Street - Coffee/Matcha`. Tips: coffee or matcha. `confidenceNote` also says Blank Street has several Boston shops and the Back Bay one was chosen because it is next to Saltie Girl. Source: `https://www.blankstreet.com/`.
    - `giulia`: Mon–Thu 17:30–21:00, Fri–Sat 17:30–22:00, Sun closed (`[]`). `hoursNote`: dinner only; listings disagree on the closing time. Aliases: `Guilia`. `matchedFrom`: `Guilia - Italian`. `bookingUrl`: `https://www.opentable.com/giulia-restaurant`. Tips: book ahead; tables open two weeks out.
    - `boston-sail-loft`: Mon–Sat 11:30–26:00, Sun 11:00–26:00. Aliases: `Sail Loft`. `matchedFrom`: `Sail Loft - Lobster Roll, seafood portofino`. Tips: the lobster roll; you also noted the seafood Portofino, which was not confirmed on a current menu. Source: `https://www.timeout.com/boston/restaurants/boston-sail-loft`.
    - `mikes-pastry`: every day 08:00–22:00. Aliases: `Mikes Pastry`. `matchedFrom`: `Mike’s Pastry`. Source: `https://www.mikespastry.com/`.
    - `zhi-wei-cafe`: Mon–Sat 11:30–20:00, Sun 12:00–20:00. `hoursNote`: Friday and Saturday hours were not confirmed. Aliases: `Zei Wei`, `Zhi Wei`. `matchedFrom`: `Zei Wei - Taiwan noodle`. `confidenceNote` also says the sources describe Lanzhou-style hand-pulled noodles, not Taiwanese. Source: `https://guide.michelin.com/en/massachusetts/boston_2914838/restaurant/zhi-wei-cafe`.
  - `backend/src/data/safety.json`: version `sample-2026-11-12` and two more placeholder areas in the same style as the others (`dayRisk` and `nightRisk` `low`, the same "SAMPLE PLACEHOLDER - not checked" note): `north-end`, "North End (sample)", center 42.3645, -71.0545, radius 0.3 km; and `porter-square`, "North Cambridge / Porter Square (sample)", center 42.385, -71.1195, radius 0.6 km. `transit.json` does not change.
  - Tests: `backend/test/data.test.ts` (your seven entries: six match their place, `Quin Long - Malatang Hotpot` matches nothing; an alias shorter than five characters only matches when equal; an existing name still wins over an alias) and `backend/test/data-check.test.ts` (18 places; a non-list `aliases` is refused). Update the data version in the tests that name it.
- [ ] **Stops inside opening hours (FR12, US7.3).**
  - `backend/src/lib/hours.ts` (new), all pure functions over a `Place` and a date:
    - a weekday key that is missing means the hours are unknown and nothing is limited; `[]` means closed that day;
    - a closing time past midnight (`26:00`) counts up to 24:00 on that date, because no item crosses midnight;
    - `visitWindow(place, date, earliestStart)` returns the earliest start at or after `earliestStart` for which the whole visit (`typicalDwellMinutes`) fits inside one opening range, or nothing when there is none;
    - `isClosedOn(place, date)` and `isOpenFor(place, date, start, end)`.
  - `backend/src/lib/scheduler.ts`:
    - A visit starts when the place is open. If the traveler would arrive before it opens, the leg there is planned again to leave later, so the free time is spent before leaving and not at a closed door. If that later leg is refused or arrives more than 15 minutes after opening, the first leg is kept and the visit waits for opening.
    - A place that is closed on that date is refused with the new fixed reason `closed on your dates`. One that is open but cannot be finished before it closes is refused with `does not fit in your days`. Both go through the existing move-to-another-day step. A wishlist place still unplaced after that is listed with `closed on your dates` only when it is closed on every trip date (AC7.3.2), and with `does not fit in your days` otherwise.
    - Within a day, the AI's order is kept unless it would make the traveler wait: at each step the next stop is the first remaining one (in the AI's order) that can start within 30 minutes of the earliest possible arrival and still lets the day end on time; when none can, it is the remaining one with the earliest start. A stop that cannot be placed at one step is tried again at the later steps, and is refused with its last reason only when the day ends without it.
  - `backend/src/lib/validator.ts`: a new rule `opening-hours`. A visit or meal outside its place's hours on that date is a violation, so such a plan is never `SUCCEEDED`.
  - `shared/src/constants.ts` if the wait limit or the reason text belongs with the other limits.
  - Tests:
    - `backend/test/hours.test.ts`: before opening, inside, too late to finish, closed day, unknown day, past-midnight closing, two ranges in one day.
    - `backend/test/scheduler.test.ts`: a stop before opening starts at opening and the leg leaves later; a dinner-only place listed first comes after an open one; closed on that date moves to another day; closed on every date is unscheduled with `closed on your dates`; no scheduled stop in the sample data is outside its hours.
    - `backend/test/validator.test.ts`: a visit outside hours is a violation.
    - Existing expectations that change only because a stop now waits for opening are updated to the new correct times. No assertion is removed or loosened.
- [ ] **Demo account and demo trip on the local server.**
  - `backend/scripts/demo.ts` (new, never deployed):
    - `DEMO_EMAIL`, default `demo@example.com`, changed with the `DEMO_EMAIL` environment variable.
    - `demoTripRequest(now)`: title `My Boston food trip`, 2 travelers, the placeholder hotel (`My hotel`, `1 Example St, Boston`, 42.3586, -71.0585), your seven entries exactly as you wrote them, default preferences. Dates are Nov 18 10:00 to Nov 21 15:00, 2026 while that arrival is still ahead; after that, the next Wednesday 10:00 to Saturday 15:00 that is at least a day ahead, so the demo keeps working.
    - `seedDemo(...)`: sends that request through the same API handler as any other request, signed in as the demo account, and waits for the plan to finish. It uses one of the demo account's three plans for the month, like any plan. A failure is logged and does not stop the server.
  - `backend/scripts/dev-server.ts`:
    - the local sign-in name may be an email address: `A-Z a-z 0-9 . _ @ + -`, up to 80 characters;
    - `GET /dev/demo` (no sign-in, local server only) answers `{ "user": "<demo email>", "planId": "<id or null>" }`;
    - `createDevServer({ seedDemo })` seeds the demo account unless `seedDemo` is `false` (environment: `DEV_SEED_DEMO=0`), and exposes a `demo` promise that settles when the demo trip is ready;
    - the start-up line names the demo account.
    - The scripted stand-in for the AI is unchanged.
  - Tests: `backend/test/demo.test.ts` (the request passes validation; the dates before, on and after Nov 18 2026; the entries are your exact wording) and `backend/test/dev-server.test.ts` (the demo account signs in with its email and already has one finished trip; six of your places are scheduled inside their hours and `Quin Long - Malatang Hotpot` is listed as "not in the Boston data"; another user still sees an empty list; `/dev/demo` names the account; `seedDemo: false` starts empty; a sign-in name with a character outside the list is refused).
- [ ] **Web app: demo sign-in and the "Not scheduled" list.**
  - `frontend/src/auth.tsx`: the local sign-in page asks the local server for its demo account (`GET /dev/demo`) and, when there is one, shows a "Use the demo account" button (`data-testid="demo-sign-in"`) that signs in as it. The name field accepts an email address. When the local server has no demo account or cannot be reached, the page is as it is today.
  - `frontend/src/api.ts`: `fetchDemoAccount(apiUrl)`. `frontend/src/main.tsx` passes the API address to the local sign-in.
  - `frontend/src/App.tsx`: a finished plan with unscheduled wishlist entries shows a "Not scheduled" card (`data-testid="unscheduled"`) with each entry and its reason. A wishlist stop is marked in the day list. Interactive elements added here get `data-testid` attributes.
  - Tests: `frontend/src/auth.test.tsx` (the button appears and signs in as the demo account; no button when the server has none or is down; a typed email signs in) and `frontend/src/App.test.tsx` (the "Not scheduled" card lists the entry and its reason, and is absent when everything was scheduled).
- [ ] **Run the demo end to end in a browser.**
  - Start the local API and the web app, each in its own terminal.
  - Sign in with "Use the demo account". Check that the trip is in the list and Ready, that it has four days, that every scheduled stop is one of your places at a time it is open, that each day with stops shows its map, and that the "Not scheduled" card names `Quin Long - Malatang Hotpot`.
  - Create a second trip as the demo account, rename it and delete it. Sign in as another local name and check it sees none of the demo account's trips.
  - Check there are no errors in the browser console, no failed requests and no error lines in the local server's output. (This first allowed the missing `/config.json` as expected. The run showed it and a missing page icon as red errors in the console on every page load, so both were fixed and nothing is allowed any more.)
  - Fix whatever breaks, with a test for each fix, and repeat until a whole run is clean. Record what was checked in `code-summary.md`.
  - A Playwright connection was not available in this session and the Chrome extension was not connected, so the run used the Playwright library driving the Chrome installed on this computer.
- [ ] Run the Step 15 test commands in `unit-test-instructions.md`. Then confirm from the repository root that these pass: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run validate:data`, `npm test` (at least 80% line coverage in `backend` and `infra`) and `npm run build -w @jarvel/frontend`. Never lower the threshold. Update `backend/README.md` (a "Demo account" part under "Running locally", and the opening-hours rule), `code-summary.md` and `traceability.json`.

## Story-to-Step Traceability

| Story | Steps |
|-------|-------|
| US1.1 | 9 (Cognito first sign-in is handled by Cognito), 11 |
| US1.2, US1.3 | 9, 10, 11 |
| US2.1, US2.2 | 3, 4, 9, 10 |
| US2.3 | 5, 6, 9, 10 |
| US2.4, US2.5 | 5, 6, 7, 8, 9, 10 |
| US3.1, US3.2, US3.3 | 5, 7, 8, 9, 10 |
| US4.1–US4.7 | 3, 7, 8 |
| US5.1, US5.2 | 7, 8, 9, 10 |
| US5.3, US5.4 | 5, 6, 9, 10, 11 |
| US6.1, US6.2, US6.3 | 9, 10, 11 |
| US6.4 | 3, 4 |
| US6.5 | 7, 11 |
| US6.3 (R-07, R-08) | 13, 14 |
| US7.4 / FR13 (list and rename, added Nov 3; R-10) | 14 |
| Trip map (your Nov 3 request; not a written story) | 14 |
| US7.3 / FR12 (opening hours, pulled in on Nov 12 for the demo) | 15 |
| US4.2 / FR3.1, FR3.5 (wishlist matching by other spellings; "not in the Boston data" shown in the web app) | 15 |
| Demo account and demo trip (your Nov 12 request; not a written story) | 15 |

## Known Limits of This Plan

- US1.1's password-change flow is Cognito's own (`NEW_PASSWORD_REQUIRED`). Tests check the stack configuration and the API's refusal without a valid token. They do not drive Cognito itself, which needs real AWS (smoke check).
- The sample Boston data is not hand-checked. Plans built on it are for testing only until you replace it.
- AC3.2.2 (19 of the last 20 staging plans under 5 minutes) and AC6.5.2 (the budget alarm firing) can only be measured on a real deployment, so they are left for the smoke check in Build and Test and Operation.
- Step 15: the six places added from your list come from a web search, not from a visit or a call. Their opening hours can be wrong, and a plan that keeps to them can still arrive at a closed door. The demo account exists only on the local server; it is not a Cognito account.
