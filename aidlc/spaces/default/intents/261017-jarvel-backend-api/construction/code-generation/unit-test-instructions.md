# Unit Test Instructions: Jarvel Backend API

## Framework and Configuration

- **Runner:** Vitest (already declared in `backend` and `infra`), with `@vitest/coverage-v8` added in plan Step 1.
- **Configuration:** `backend/vitest.config.ts` and `infra/vitest.config.ts` set:
  - `test.include: ['test/**/*.test.ts']`;
  - the v8 coverage provider, reporting to `coverage/`, which git ignores;
  - `coverage.thresholds.lines: 80`.

  The threshold must never be lowered to make a run pass.
- **Methodology:** test-after, from the Testing Contract in `code-generation-plan.md`. Implement a layer, then write and run that layer's tests before the next layer.

## How to Run This Build's Tests

Every command is run from the repository root and names exact test files. This build has no Units, so its scope is the backend and infra test files listed below.

Runner check (plan Step 2, before the first test step):

```bash
npx vitest run --root backend test/smoke.test.ts
```

Data model (plan Step 4):

```bash
npx vitest run --root backend test/data.test.ts test/data-check.test.ts test/schemas.test.ts test/time.test.ts test/sun.test.ts
```

Repository and data access (plan Step 6):

```bash
npx vitest run --root backend test/store.test.ts test/quota.test.ts test/idempotency.test.ts
```

Business logic (plan Step 8):

```bash
npx vitest run --root backend test/router.test.ts test/safety.test.ts test/ai.test.ts test/scheduler.test.ts test/validator.test.ts test/planner.test.ts test/markdown.test.ts
```

API and admin (plan Step 10):

```bash
npx vitest run --root backend test/api.test.ts test/admin.test.ts
```

Infrastructure (plan Step 11):

```bash
npx vitest run --root infra test/jarvel-stack.test.ts
```

Revision of Nov 12 (plan Step 14): the map, R-07 to R-10, and the web app:

```bash
npx vitest run --root backend test/scheduler.test.ts test/store.test.ts test/admin.test.ts test/api.test.ts test/quota.test.ts test/dev-server.test.ts
npx vitest run --root infra test/jarvel-stack.test.ts
npx vitest run --root frontend src/map.test.ts src/App.test.tsx
```

The web app's tests run in jsdom (`frontend/vite.config.ts`). `react-leaflet` is replaced by a stub in `App.test.tsx`, because jsdom cannot draw maps. The real map was checked in the Step 14 browser run (see `code-summary.md`, "Step 14", item 6).

Revision of Nov 12 (plan Step 15): your places, opening hours, the demo account and the web app's demo sign-in:

```bash
npx vitest run --root backend test/data.test.ts test/data-check.test.ts test/hours.test.ts test/scheduler.test.ts test/validator.test.ts test/planner.test.ts test/markdown.test.ts test/demo.test.ts test/dev-server.test.ts
npx vitest run --root frontend src/auth.test.tsx src/App.test.tsx src/local-config-plugin.test.ts
```

`src/local-config-plugin.test.ts` covers the local web server's answer for `/config.json` and the web app's fallback to local mode (the browser-run fix of Step 15).

The Step 15 tests need no network and no AWS: the demo account is seeded into the same in-memory table, and the web app's tests replace `fetch` with a fake. The six places added in Step 15 are real businesses, so tests that need a made-up situation (a place closed on every date, a place with two opening ranges) build their own small place instead of changing the data files.

Coverage for this build (plan Step 12, and again after Steps 14 and 15; add `test/dev-server.test.ts`, `test/hours.test.ts` and `test/demo.test.ts` to the backend list):

```bash
npx vitest run --root backend --coverage test/smoke.test.ts test/data.test.ts test/data-check.test.ts test/schemas.test.ts test/time.test.ts test/sun.test.ts test/store.test.ts test/quota.test.ts test/idempotency.test.ts test/router.test.ts test/safety.test.ts test/ai.test.ts test/scheduler.test.ts test/validator.test.ts test/planner.test.ts test/markdown.test.ts test/api.test.ts test/admin.test.ts
npx vitest run --root infra --coverage test/jarvel-stack.test.ts
```

## Expected Coverage

- At least 80% line coverage in `backend` and in `infra` (team Testing Posture, `feature` scope floor).
- Standard strategy: 5 to 8 tests per component, about 90 in total. Each test file covers the happy path and at least two error or edge cases (construction guardrail).

## Mocking and Stubbing

- **No paid AWS or AI calls in any test** (project rule). The suite runs with no AWS credentials set.
- DynamoDB, Lambda invoke and Cognito are faked with `aws-sdk-client-mock`. Conditional-write failures are simulated with `ConditionalCheckFailedException`, to test the quota and status-transition rules.
- Bedrock is never called. `lib/ai.ts` takes an injected model client, and tests pass a fake that returns fixed answers: valid, invalid, rule-breaking, or one that throws.
- Time is controlled with `vi.useFakeTimers()` and `vi.setSystemTime()` for month resets, deadlines, retention and "arrival in the future" checks.
- CDK tests use `aws-cdk-lib/assertions` `Template.fromStack` and never deploy.

## Test Data

- The tests use the sample Boston dataset in `backend/src/data/*.json` (marked `sample: true`). Tests that need a specific situation build a small inline fixture network or area: an area with `avoidAfter`, a line whose last train is early, or a place with no safety area.
- `backend/test/fixtures/` holds the shared `TripRequest` builders (a valid 4-day trip from Nov 18 10:00 to Nov 21 15:00, plus limit-edge variants) and fake AI answers.
- No test depends on another test's state; each sets up its own mocks.
