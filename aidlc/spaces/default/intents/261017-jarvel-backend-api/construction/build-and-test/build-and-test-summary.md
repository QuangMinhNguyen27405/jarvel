# Build and Test Summary: Jarvel Backend API

Run on 2026-11-14. This build has no Units.

## Overall Build Status

- **The build succeeds.** The type check, lint, format check, data check, web app build and the local infrastructure build (`cdk synth`) all exit with code 0.
- **All 363 tests pass**, with none failed and none skipped.
- **Two targets could not be verified**, because one needs a deployed staging stack and the other needs a CI workflow. Neither exists yet. See "Target Verification Matrix".
- **Prerequisites:** Node.js 22 or later and `npm ci`. No AWS account, credentials or local services are needed. The steps are in `build-instructions.md`.

## Test Type Inventory

The test strategy is Minimal (express plan type), so this stage wrote no extra test instruction files.

| Test type | Instruction file | Status |
|---|---|---|
| Unit tests | `../code-generation/unit-test-instructions.md` | Written in Code Generation. Run here: all pass. |
| Integration tests | none written | Not required under Minimal. The suite already has tests across boundaries: the API handler with the planner and the in-memory table, and the local server over HTTP (`backend/test/api.test.ts`, `backend/test/dev-server.test.ts`). |
| Performance tests | none written | Not required under Minimal. The speed targets (NFR1, NFR2) can only be measured on staging. |
| Security tests | none written | Not required under Minimal. The infrastructure tests check that no permission uses a `*` resource and that sign-up is off (`infra/test/jarvel-stack.test.ts`). |
| Smoke check on a deployment | `backend/README.md`, "Post-deploy smoke check" | Not run. Nothing is deployed. |

## Coverage Expectations

| Package | Expected | Actual |
|---|---|---|
| `backend` | at least 80% of lines | 96.38% |
| `infra` | at least 80% of lines | 98.3% |
| `frontend` | no floor set | not measured (45 tests pass) |

The 80% floor is the team's rule. It was not lowered, and it still applies under the express plan type.

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| TC-1 | Testing Contract, `obligations.scope_floor`: "Keep the existing test suite green." | 0 failing tests | 363 passed, 0 failed, 0 skipped | `test-results.md`, "Test Results" | build-and-test | Met |
| TC-2 | Testing Contract, `obligations.strategy_volume`: "One verifiable test per requirement at the narrowest effective level." The part that can be tested without a deployed stack. | Every built requirement has at least one passing automated test | 84 of the 89 Must acceptance criteria and all 4 built Should criteria map to a test file that passed | `cross-unit-traceability.md`, "Covered Acceptance Criteria" | build-and-test | Met |
| TC-3 | The same target as TC-2. The part whose narrowest effective test needs a deployed stack. | Each is checked once on staging: FR1.2 (AC1.1.1 to AC1.1.4), NFR1 (AC3.2.2), NFR2, NFR7, and the staging measures of NFR3, NFR6, NFR8 and NFR10 | Not measured. Nothing is deployed. | None yet. Expected in `operation/deployment-execution/` and `operation/observability-setup/` | deployment-execution; observability-setup | Unverified |
| TC-4 | Testing Contract, `obligations.strategy_volume`: "At least one happy-path unit test per component." | Each component has at least one passing happy-path test | All 11 components have one | `test-results.md`, "Test Results" | build-and-test | Met |
| TC-5 | Testing Contract, team note: "Coverage floor: at least 80% line coverage" | At least 80% of lines in `backend` and in `infra` | `backend` 96.38%, `infra` 98.3% | `test-results.md`, "Coverage Report" | build-and-test | Met |
| TC-6 | Testing Contract, team note: coverage is "checked in CI before a pull request can merge" (also NFR10) | A CI run does the type check, lint, format check and tests with coverage on every pull request | There is no CI workflow in the repository | None | deployment-pipeline. The CI Pipeline stage is not part of the express plan. | Unverified |

Four targets are Met and two are Unverified. The full rows, with the diagnosis for the two, are in `test-results.md`.

## Readiness Assessment

| Question | Answer | Why |
|---|---|---|
| Build-ready | **Yes** | Every build command passes on a clean checkout with `npm ci`. |
| Test-ready | **Yes, locally** | All 363 tests pass and coverage is above the floor. There is no CI run yet (TC-6). |
| Deployment-ready | **Ready for a first staging deploy, not for production** | The template and both function bundles build. The checks that need a deployment have not run (TC-3), and the Boston data is still sample data. |

Because two targets are Unverified, this stage does not report a fully successful result. The builder chose to accept that and carry on (see `test-results.md`, "Decision"). Both targets stay Unverified until a later stage checks them.

## Known Limitations and Outstanding Items

- **Nothing is deployed.** The first sign-in flow, the 5-minute plan time, the 2-second API time, the alarms, the budget alert and the smoke check are all untried on real AWS.
- **There is no CI workflow.** The team rule is that the type check and the tests pass in CI before a merge to `main`. Today they are only run by hand.
- **AC3.2.2 is the one Must acceptance criterion not covered.** It needs 20 staging plans. See `cross-unit-traceability.md`.
- **Four Should requirements were not built:** FR10 (relaxed pace by rule), FR11 (cost estimate with whole cents), FR14 (share links) and FR15 (booking links), with their 11 acceptance criteria. They were never in the approved code plan.
- **The Boston data is sample data.** Every plan says so. It must be replaced with hand-checked data before anyone relies on a plan.
- **The web app is checked less than the API.** ESLint and Prettier both skip `frontend/`, so `npm run lint` and `npm run format:check` pass without looking at it (review note R-16 found 5 web app files that do not match the formatter). It has no coverage floor, and its Cognito sign-in has not been tried against a real user pool.
- **The real AI model has not been called.** Tests and the local server use a stand-in. The first real Bedrock call happens in the smoke check.
- **Four small review notes from Code Generation are still open** (R-15 to R-18 in `../code-generation/reviews/review-08.md`): the test count in the plan's summary, linting and formatting of the web app, one-word wishlist entries such as "Coffee" matching a place, and `/dev/demo` being reachable from the network if `HOST` is set on the local server.
