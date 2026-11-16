# Developer Code Scan: Jarvel

Full scan of the whole repository at commit `1eb36104c8a77aa53ad921b46a46e41eb677d4d3` plus the untracked working tree (2026-10-22). `docs/ARCHITECTURE.md` was read for context only. Every statement below describes what the files on disk contain.

## Developer Code Scan Results

### Scan Coverage
- **Analyzed deeply**:
  - `package.json`
  - `tsconfig.base.json`
  - `.gitignore` (project part, above the AI-DLC block)
  - `package-lock.json` (workspace entries and the resolved versions of direct dependencies)
  - `README.md`
  - `shared/package.json`
  - `shared/src/index.ts`
  - `shared/src/types.ts`
  - `backend/package.json`
  - `frontend/package.json`
  - `infra/package.json`
  - `docs/ARCHITECTURE.md` (context only, never a source)
- **Skimmed only**:
  - `package-lock.json` transitive dependency entries
- **Left out**:
  - `node_modules/` (installed dependencies)
  - `.git/`
  - `.claude/` (AI-DLC install)
  - `aidlc/` (AI-DLC workspace)

Nothing else exists. `backend/`, `frontend/` and `infra/` each hold only a `package.json`: no `src/`, no `tsconfig.json`, no tests, no config files.

### Packages Found
- `jarvel` (root) — npm workspace root, private — none (scripts only) — runs scripts across workspaces; `engines.node >=22`
- `@jarvel/shared` — library, source-only (no build step; `exports` points at `./src/index.ts`) — TypeScript — shared domain and API contract types
- `@jarvel/backend` — intended Lambda service — TypeScript (declared) — manifest only, **no source**
- `@jarvel/infra` — intended AWS CDK v2 app — TypeScript (declared) — manifest only, **no source**
- `@jarvel/frontend` — intended React and Vite single-page app — TypeScript (declared) — manifest only, **no source**

### Build System
- **Type**: npm workspaces (lockfile v3), ES modules (`"type": "module"` everywhere), TypeScript compiler 7 for type checks, Vite 8 (frontend), esbuild 0.28 (backend, infra), AWS CDK CLI 2.1145 (infra), Vitest 5 (tests)
- **Config Files**: `package.json`, `package-lock.json`, `tsconfig.base.json`, the four workspace `package.json` files. Missing although scripts call them: `backend/tsconfig.json`, `infra/tsconfig.json`, `frontend/tsconfig.json`, `infra/cdk.json`, `frontend/vite.config.*`, `frontend/index.html`, any Vitest config.
- **Build Dependencies**: no workspace declares a dependency on another. `@jarvel/shared` is reachable from the others only because npm links every workspace into `node_modules/@jarvel/` (lockfile lines 1753-1767). Root `synth` and `deploy` run `build:frontend` (the frontend `build`) before the infra `synth` or `deploy`.
- **Verified run (2026-10-22)**: `npm run typecheck` fails in backend, infra and frontend with `TS5058: The specified path does not exist: '<pkg>/tsconfig.json'`. `npm test` fails in all three with `No test files found, exiting with code 1`. Neither result counts as a regression: there is no code yet.

### APIs Discovered
- HTTP API contract, **declared in comments only** — `shared/src/types.ts` lines 340-349 — 6 routes (`GET /catalog`, `POST /plans`, `GET /plans`, `GET /plans/{planId}`, `POST /plans/{planId}/revise`, `DELETE /plans/{planId}`), with request and response types at lines 194-210, 233-249 and 351-363. No handler, router, or OpenAPI file exists.
- Step Functions state contract (type only) — `shared/src/types.ts` lines 373-385 (`StepState`) — no state machine exists.

### Frameworks & Libraries
Resolved versions come from `package-lock.json` and match the declared caret ranges exactly.
- `@aws-sdk/client-bedrock-runtime`, `client-dynamodb`, `client-s3`, `client-sfn`, `lib-dynamodb` — 3.1152.0 — backend AWS clients (unused, no source)
- `zod` — 4.6.7 — backend validation (unused)
- `aws-cdk-lib` — 2.273.0; `constructs` — 10.8.1; `aws-cdk` CLI — 2.1145.0 — infra (unused)
- `react`, `react-dom` — 19.3.1; `aws-amplify` — 6.22.2; `@aws-amplify/ui-react` — 6.15.7; `leaflet` — 1.9.4; `react-leaflet` — 5.0.0 — frontend (unused)
- `typescript` — 7.0.2; `vitest` — 5.0.5; `esbuild` — 0.28.2; `vite` — 8.3.4; `@vitejs/plugin-react` — 6.1.2; `tsx` — 4.23.15; `jsdom` — 30.1.3; `@testing-library/react` — 16.3.3; `@testing-library/jest-dom` — 7.0.1; `@types/node` — 26.6.5; `@types/aws-lambda` — 8.10.164; `@types/leaflet` — 1.9.22; `@types/react`, `@types/react-dom` — 19.3.0

### Test Coverage
- **Test Directories**: none
- **Test Frameworks**: Vitest 5 declared in backend, infra and frontend; Testing Library and jsdom in frontend
- **Coverage Config**: absent (only `coverage/` is git-ignored)

### Code Quality Indicators
- **Linting**: none. No ESLint, Prettier or EditorConfig file. Strict TypeScript settings in `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `noEmit`) are the only quality gate, and no workspace tsconfig extends it yet.
- **CI/CD**: none (no `.github/`, no buildspec, no pipeline file)
- **Documentation**: `README.md` is a one-line title. `shared/src/types.ts` is well commented (units, formats, example values, foreign-key hints). `docs/ARCHITECTURE.md` describes a full system that is not in the code.

### Technical Debt Signals
- Scripts point at files that do not exist (missing workspace tsconfig, no tests, no `cdk.json`, no Vite entry), so `typecheck`, `test`, `build:frontend`, `synth` and `deploy` all fail today — `*/package.json` scripts.
- Workspace dependencies are undeclared: backend, infra and frontend would import `@jarvel/shared` without listing it — `backend/package.json`, `infra/package.json`, `frontend/package.json`.
- `@jarvel/shared` ships raw `.ts` with no build and re-exports `./types.js`. That only resolves under a bundler or `moduleResolution: Bundler`, so plain Node cannot load it at runtime — `shared/package.json`, `shared/src/index.ts` line 1.
- The API contract exists only as comments, with no schema (zod or OpenAPI) — `shared/src/types.ts` lines 340-349.
- The error body `{ error: string }` has no machine-readable code or request id — `shared/src/types.ts` line 349.
- The data model is shaped around one trip: `TripDefaults` holds fixed arrival and departure dates, `airportCode: 'BOS'` and `novemberClimate` — `shared/src/types.ts` lines 147-155.
- The contract still carries features the approved scope leaves out: revise (`ReviseRequest`, `PlanRecord.revisions`, `POST /plans/{planId}/revise`) and `FrontendConfig` for the web app. It has no field for the per-person plan quota the scope requires — `shared/src/types.ts` lines 205-210, 240, 347, 365-371.
- The infra deploy script uses `cdk deploy --require-approval never`, which skips the IAM and security-group change review — `infra/package.json` line 11. Its output file `cdk-outputs.json` is not git-ignored.
- `@types/node` 26 is ahead of the runtime floor `engines.node >=22` — `backend/package.json`, `package.json` line 6.
- Almost nothing is committed: HEAD (`1eb3610`) contains only `README.md`, and every other file is untracked.
- No TODO, FIXME, HACK or lint-suppression comments (the only source file is `types.ts`).

## Handoff Summary
- **Intent-relevant finding**: The backend API does not exist. `backend/` holds only `backend/package.json`, which declares AWS SDK v3 clients and zod, with no `src/`, handlers, data files or tests. The only reusable asset is the contract in `shared/src/types.ts`: domain types (lines 9-172), plan records (lines 178-249), itinerary output (lines 255-338), the HTTP route list as comments (lines 340-349) and `StepState` (lines 378-385).
- **Risks / follow-up**: (1) The shared contract partly conflicts with the approved scope (revise is out of scope, and the plan quota is missing). Requirements Analysis must decide whether to keep, trim or extend these types; do not treat them as approved. (2) Treat every element of `docs/ARCHITECTURE.md` as unimplemented and unconfirmed: Lambda handlers, agents, Step Functions, DynamoDB, S3, Cognito, CloudFront, the Bedrock tool loop, the curated data JSON, the validator and the tests. (3) The toolchain is not runnable (`typecheck` and `test` fail, as verified above), so Construction must first add workspace tsconfigs, a Vitest pass-with-no-tests or real tests, and workspace dependency declarations. (4) Remove or justify `--require-approval never` before Operation.
