# Test Results: Jarvel Backend API

Run on 2026-11-14 from the repository root, on Windows 11 with Node 24.19.0 and npm 11.17.0. Dependencies were already installed from `package-lock.json`. No command called AWS or the AI model, and nothing was deployed.

## Build Status

**Success.** Every build command exited with code 0.

| Command | Exit code | Output |
|---|---|---|
| `npm run typecheck` | 0 | No errors in `shared`, `backend`, `infra` or `frontend`. |
| `npm run lint` | 0 | No problems (`shared`, `backend`, `infra`). |
| `npm run format:check` | 0 | "All matched files use Prettier code style!" The check skips `frontend/`, `docs/` and `aidlc/` (`.prettierignore`). |
| `npm run validate:data` | 0 | "Boston data OK: 18 places, 21 stations, 12 safety areas." plus the sample-data warning, which is expected. |
| `npm run build:frontend` | 0 | Built in under 1 second. Vite's note about a chunk over 500 kB is expected: it is the Cognito sign-in code. |
| `npm run synth -w @jarvel/infra -- -c stage=staging -c alertEmail=you@example.com` | 0 | Bundled `PlannerFn` and `ApiFn` and wrote the `Jarvel-staging` template to `infra/cdk.out/`. Local only, no deploy. |

## Test Results

**363 tests: 363 passed, 0 failed, 0 skipped.**

| Command | Test files | Tests | Result |
|---|---|---|---|
| `npm test` (backend) | 21 passed of 21 | 303 passed of 303 | pass |
| `npm test` (infra) | 1 passed of 1 | 15 passed of 15 | pass |
| `npm test` (frontend) | 4 passed of 4 | 45 passed of 45 | pass |

`npm test` exited with code 0.

Each scoped command in `../code-generation/unit-test-instructions.md` was also run once. Identical commands were run once only. The test counts overlap, because several commands name the same files, so they are not added to the total above.

| Scoped command (`npx vitest run ...`) | Test files | Tests | Exit code |
|---|---|---|---|
| `--root backend test/smoke.test.ts` | 1 | 1 passed | 0 |
| `--root backend` data, data-check, schemas, time, sun | 5 | 56 passed | 0 |
| `--root backend` store, quota, idempotency | 3 | 53 passed | 0 |
| `--root backend` router, safety, ai, scheduler, validator, planner, markdown | 7 | 99 passed | 0 |
| `--root backend` api, admin | 2 | 54 passed | 0 |
| `--root infra test/jarvel-stack.test.ts` | 1 | 15 passed | 0 |
| `--root backend` scheduler, store, admin, api, quota, dev-server (Step 14) | 6 | 143 passed | 0 |
| `--root frontend` map, App (Step 14) | 2 | 17 passed | 0 |
| `--root backend` data, data-check, hours, scheduler, validator, planner, markdown, demo, dev-server (Step 15) | 9 | 139 passed | 0 |
| `--root frontend` auth, App, local-config-plugin (Step 15) | 3 | 41 passed | 0 |

The two coverage commands in the instructions list fewer test files than the suite has now. `npm test` runs every test file with coverage, so it was used for the coverage figures below.

## Failure Details

No build command and no test failed. There is no failing test name, assertion or stack trace to report.

## Coverage Report

| Package | Statements | Branches | Functions | Lines | Floor (lines) |
|---|---|---|---|---|---|
| `backend` | 95.2% | 87.85% | 93.34% | **96.38%** | 80% |
| `infra` | 98.38% | 100% | 100% | **98.3%** | 80% |
| `frontend` | not measured | not measured | not measured | not measured | none set |

- The floor is set in `backend/vitest.config.ts` and `infra/vitest.config.ts` (`thresholds: { lines: 80 }`). It was not changed.
- The lowest files by line coverage are `backend/src/handlers/planner.ts` (53.33%; the uncovered part is the production environment setup), `backend/scripts/validate-data.ts` (77.41%), `backend/scripts/admin.ts` (86.25%) and `backend/src/lib/dynamo.ts` (87.87%).
- `backend/scripts/dev-server.ts` is left out of the coverage count by the configuration. It has its own test file, `backend/test/dev-server.test.ts`.
- `infra/bin/jarvel.ts` is the only uncovered infra file. It is a one-line entry point.
- The web app has tests but no coverage measurement and no floor. The team rule names `backend` and `infra`.

## Target Verification Matrix

The targets come from the `## Testing Contract` in `../code-generation/code-generation-plan.md`. There are no NFR Requirements or NFR Design files to read, because those stages were skipped. The contract was replaced on Nov 14 when this work moved to the express plan type; that replacement was made by the workflow tool and was not a separate approval of yours.

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| TC-1 | Testing Contract, `obligations.scope_floor`: "Keep the existing test suite green." | 0 failing tests | 363 passed, 0 failed, 0 skipped | `npm test`, exit code 0 ("Test Results" above) | build-and-test | Met |
| TC-2 | Testing Contract, `obligations.strategy_volume`: "One verifiable test per requirement at the narrowest effective level." The part that can be tested without a deployed stack. | Every built requirement has at least one passing automated test | 84 of the 89 Must acceptance criteria and all 4 built Should criteria map to a test file that passed. The other 5 Must criteria are TC-3. | `cross-unit-traceability.md`, "Covered Acceptance Criteria" | build-and-test | Met |
| TC-3 | The same target as TC-2. The part whose narrowest effective test needs a deployed stack. | Each is checked once on staging: FR1.2 (AC1.1.1 to AC1.1.4, first sign-in password change), NFR1 (AC3.2.2, 19 of 20 plans under 5 minutes), NFR2 (95% of calls under 2 seconds), NFR7 (99% availability over 30 days), and the staging measures of NFR3 (monthly bill under $25), NFR6 (no email in logs), NFR8 (alarms record a failed plan) and NFR10 (smoke check after a deploy) | Not measured. Nothing is deployed. | None yet. Expected in `operation/deployment-execution/smoke-test-results.md` and `health-check-report.md`, and in `operation/observability-setup/alarms.md` and `slo-config.md` | deployment-execution (FR1.2, NFR1, NFR2, NFR3, NFR6, NFR10); observability-setup (NFR7, NFR8) | Unverified |
| TC-4 | Testing Contract, `obligations.strategy_volume`: "At least one happy-path unit test per component." | Each component has at least one passing happy-path test | All 11 components have one: Boston data, request validation, time and hours, storage, planning rules, AI adapter and planner, API handler, admin script, local server and demo, infrastructure stack, web app | The 26 test files in "Test Results" above. `shared` holds only types and constants and is covered by the type check. | build-and-test | Met |
| TC-5 | Testing Contract, team note: "Coverage floor: at least 80% line coverage" | At least 80% of lines in `backend` and in `infra` | `backend` 96.38%, `infra` 98.3% | "Coverage Report" above | build-and-test | Met |
| TC-6 | Testing Contract, team note: coverage is "checked in CI before a pull request can merge" (also NFR10) | A CI run does the type check, lint, format check and tests with coverage on every pull request | There is no CI workflow in the repository | None | deployment-pipeline (the pipeline that deploys on merge). The CI Pipeline stage is not part of the express plan. | Unverified |

## Targets Not Verified

Two targets are `Unverified`, so by this stage's rule Build and Test has not fully passed, although no command failed.

- **Diagnosis.** TC-3 needs a deployed staging stack. TC-6 needs a CI workflow. Neither exists yet.
- **Root cause.** It is not in the code that was built and not in the build or test setup. The stack has never been deployed, and the stage that writes the CI workflow is not part of the express plan type.
- **In-stage fix.** None. No change to the test configuration or the build scripts can produce a staging measurement or a CI run.
- **Candidate fix in Code Generation.** None. No library, version, flag or algorithm change would verify these.
- **What would verify them.** TC-3: deploying staging and running the smoke check, which is the Deployment Execution stage and needs your approval and your AWS account. TC-6: adding the GitHub Actions workflow, in the Deployment Pipeline stage or as its own piece of work.
- **Loop-backs used:** 0 of 3.

## Decision

The builder was asked how to proceed on 2026-11-14 and chose **Accept failure** (answer received 2026-11-15).

- TC-3 and TC-6 stay `Unverified`. Accepting them does not mark them as met.
- TC-3 is to be checked in Deployment Execution (the staging smoke check) and Observability Setup.
- TC-6 is to be closed by adding the CI workflow, in Deployment Pipeline or as its own piece of work.
- No code was changed and no loop-back was made.
