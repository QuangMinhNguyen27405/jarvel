# Component Inventory

Five components, one per npm package. Status values: **Implemented** (code exists), **Scaffold** (manifest only), **Root** (orchestration only).

## workspace-root

- **Package**: `jarvel` (private), `package.json` at the repo root
- **Status**: Root
- **Responsibility**: Declares the workspaces `shared`, `backend`, `infra` and `frontend`, requires Node 22 or later, and fans scripts out to the workspaces: `typecheck`, `test`, `build:frontend`, `synth`, `deploy`.
- **Depends on**: all four workspaces (through npm workspaces)
- **Notes**: Both `typecheck` and `test` currently fail; see [code-quality-assessment.md](code-quality-assessment.md). No `build` script exists.

## shared

- **Package**: `@jarvel/shared` 0.1.0, `shared/`
- **Status**: Implemented (types only)
- **Responsibility**: The single contract for the domain (places, transit, safety, trip defaults), the API (trip request, plan records, catalog), the itinerary output and the workflow step state.
- **Files**: `src/index.ts`, `src/types.ts`
- **Depends on**: nothing
- **Consumed by**: no file imports it yet. Its header comment names backend, infra and frontend as consumers.

## backend

- **Package**: `@jarvel/backend` 0.1.0, `backend/`
- **Status**: Scaffold
- **Responsibility (intended, from dependencies only)**: API and processing code for AWS Lambda using DynamoDB, S3, Step Functions and Bedrock, with zod validation.
- **Files**: `package.json` only
- **Depends on**: AWS SDK v3 clients and zod (declared, unused); `@jarvel/shared` is not declared
- **Notes**: `docs/ARCHITECTURE.md` describes handlers, agents, libraries, data JSON and tests under `backend/src` and `backend/test`. They are **described in the doc but not implemented**.

## infra

- **Package**: `@jarvel/infra` 0.1.0, `infra/`
- **Status**: Scaffold
- **Responsibility (intended)**: AWS CDK v2 application.
- **Files**: `package.json` only (no `cdk.json`, `bin/` or `lib/`)
- **Depends on**: `aws-cdk-lib` and `constructs` (declared, unused)
- **Notes**: `deploy` uses `--require-approval never`. The CDK stack described in ARCHITECTURE.md is **not implemented**.

## frontend

- **Package**: `@jarvel/frontend` 0.1.0, `frontend/`
- **Status**: Scaffold
- **Responsibility (intended)**: React single-page app with Amplify authentication and a Leaflet map.
- **Files**: `package.json` only (no `index.html`, `src/` or Vite config)
- **Depends on**: React 19, Amplify v6, Leaflet (declared, unused)
- **Notes**: The approved scope leaves the traveler web app out of this version. Whether this package stays is an open question for Requirements Analysis.
