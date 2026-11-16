# Code Quality Assessment

## Summary

The project is at the **scaffold stage**. The one source file, `shared/src/types.ts`, is clean and well documented. The rest of the repository is dependency manifests whose scripts cannot run yet. No tests, linting or CI exist.

## Verified Baseline (2026-10-22)

| Command | Result |
|---|---|
| `npm run typecheck` | **Fails**: `TS5058` because `tsconfig.json` is missing in backend, infra and frontend (shared has no script) |
| `npm test` | **Fails**: Vitest reports `No test files found, exiting with code 1` in backend, infra and frontend |
| Tests total / passing / coverage | 0 / 0 / not measurable |

Neither result is a regression: there is no code to break. Construction must first make both commands pass (for example, add workspace tsconfigs and either real tests or `--passWithNoTests`) so a baseline exists.

## Quality Ratings (code-analysis-guide scale)

| Dimension | Rating | Evidence |
|---|---|---|
| Naming clarity | good | Descriptive types and fields in `types.ts` |
| Function size | n/a | No functions |
| Error handling | n/a (contract: fair) | No code; the declared error body `{ error: string }` has no code or request id |
| Test presence | poor | No tests anywhere |
| Duplication | good | None |
| Dead code | good | None; manifests list unused dependencies, which is expected for a scaffold |

## Tooling

- **Linting and formatting**: none configured. Org Code Style defers to project configuration, and the project has none.
- **Type safety**: strict base config exists (`tsconfig.base.json`), but no workspace uses it.
- **CI/CD**: none. Org policy requires CI execution before merge and an 80% line-coverage floor for `feature` scope, so both must be built.
- **Documentation**: `README.md` is a title only. `types.ts` comments are good. `docs/ARCHITECTURE.md` describes a system that does not exist (see below).
- **Version control**: HEAD `1eb3610` contains only `README.md`; everything else is untracked.

## Technical Debt Register

| # | Debt | Location | Impact |
|---|---|---|---|
| TD-1 | Scripts reference missing files (workspace tsconfig, tests, `cdk.json`, Vite entry) | `*/package.json` | High: no command in the toolchain runs |
| TD-2 | `@jarvel/shared` dependency is not declared by its consumers | backend, infra and frontend `package.json` | Medium: imports work only by accident of the workspace links |
| TD-3 | Shared package ships raw TypeScript and imports `./types.js` | `shared/package.json`, `shared/src/index.ts` | Medium: consumers must bundle; plain Node cannot import it |
| TD-4 | API contract exists only as comments; no runtime schema | `shared/src/types.ts` lines 340-349 | Medium: nothing validates requests and responses |
| TD-5 | Error body has no code or request id | `types.ts` line 349 | Low |
| TD-6 | Trip defaults are hard-coded to one trip (fixed dates, `airportCode: 'BOS'`, November climate) | `types.ts` lines 147-155 | Medium for multi-user, invite-only use |
| TD-7 | Contract includes out-of-scope revise and web-app config; lacks invitation, access-control and quota fields | `types.ts` lines 205-210, 240, 347, 365-371 | High: the contract does not match the approved scope |
| TD-8 | `cdk deploy --require-approval never` | `infra/package.json` line 11 | Medium (security): skips review of IAM and security-group changes; conflicts with the Operation-phase rule that infrastructure security changes need review |
| TD-9 | `cdk-outputs.json` (written by deploy) is not git-ignored | `.gitignore` | Low |
| TD-10 | `@types/node` 26 is newer than the Node 22 runtime floor | backend, infra `package.json` | Low |
| TD-11 | No lint, format or CI configuration | repo root | Medium against the org merge policy |

There are no TODO, FIXME or HACK markers and no lint suppressions.

## Documentation vs Code Gap

`docs/ARCHITECTURE.md` is context only. The items below are **described in the doc but not implemented** in code:
- Every backend module: `src/handlers/api.ts` and the workflow step handlers; `src/agents/*` (researcher, safety, transit, scheduler, critic, budget); `src/lib/*` (bedrock, router, geo, time, hours, validator, cost, crime, weather, store, ids, http); the `src/data/*.json` knowledge base; `test/`.
- Every infrastructure item: the CDK app (`bin/jarvel.ts`, `lib/jarvel-stack.ts`), Cognito user pool, HTTP API with JWT authorizer, throttling and CORS, Lambda functions, Step Functions state machine, DynamoDB table, S3 buckets, CloudFront, Bedrock IAM, X-Ray tracing, alarms and stack outputs.
- The whole frontend (sign-in, trip setup, agent activity panel, itinerary view, map, revise box, plans list).
- Behaviours: zod validation limits, the quota of 20 plan generations per user per day, live weather and crime calls, deterministic validator rules, and the Finalize transit fill-in.

Places where the doc and the code disagree:
- The doc says React 18; the code declares 19.3.1.
- The doc lists a root `build` script; the code has none.
- The doc's step state carries `artifacts: { [agent]: s3Key }`; `StepState` has no such field and relies on fixed keys.
- The doc mentions `itineraryS3Key`; `PlanRecord` has no such field.
- The doc's quota of 20 per day conflicts with the approved scope of at most 3 plans per person per month.
