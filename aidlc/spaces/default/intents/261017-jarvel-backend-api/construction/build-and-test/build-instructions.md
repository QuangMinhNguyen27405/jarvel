# Build Instructions: Jarvel Backend API

This build has no Units. Everything is built from the repository root. Nothing here calls AWS or the AI model, and nothing here deploys.

## Prerequisites

- **Node.js 22 or later** (`node --version`). The run of 2026-11-14 used Node 24.19.0 and npm 11.17.0.
- **Git**, to check out the commit you want to build.
- No AWS account, AWS credentials or Docker are needed to build and test.

## Install Dependencies

```bash
npm ci
```

`npm ci` installs the exact versions in `package-lock.json` for all four workspaces (`shared`, `backend`, `infra`, `frontend`). It prints a warning that esbuild's postinstall script is not approved. esbuild works anyway.

## Environment Setup

- **No environment variables are needed** for the build or the tests. The test suite sets dummy AWS credentials itself and fakes DynamoDB, Lambda, Cognito and Bedrock.
- **No config files are needed.** Do not create `frontend/public/config.json` for a local build; without it the web app runs in local mode.
- **No local services are needed.** There is no database to start. The local server (`npm run dev -w @jarvel/backend`) keeps its data in memory and is only for trying the app by hand.

## Build Commands

Run these in order. Each must exit with code 0.

| Step | Command | What it builds or checks |
|---|---|---|
| 1 | `npm run typecheck` | Type-checks `shared`, `backend`, `infra` and `frontend` with strict TypeScript. |
| 2 | `npm run lint` | ESLint over `shared`, `backend` and `infra`. |
| 3 | `npm run format:check` | Prettier check of the repository, apart from what `.prettierignore` lists. That list includes `frontend/`, `docs/` and `aidlc/`, so the web app's formatting is not checked. |
| 4 | `npm run validate:data` | Checks the Boston data files. It also prints the sample-data warning, which is expected. |
| 5 | `npm run build:frontend` | Type-checks the web app and builds it into `frontend/dist/`. |
| 6 | `npm run synth -w @jarvel/infra -- -c stage=staging -c alertEmail=you@example.com` | Bundles both Lambda functions with esbuild and writes the CloudFormation template to `infra/cdk.out/`. It does not deploy and does not call AWS. |

`alertEmail` in step 6 must be an email address, or the step stops with an error naming the problem. For a local build any address works, because nothing is sent.

## Build Verification

- Steps 1 to 4 print no errors and exit 0.
- Step 4 prints `Boston data OK: 18 places, 21 stations, 12 safety areas.`
- Step 5 ends with `built in ...` and leaves `frontend/dist/index.html`.
- Step 6 prints `Bundling asset Jarvel-staging/PlannerFn/Code/Stage...` and `Bundling asset Jarvel-staging/ApiFn/Code/Stage...`, then the template, and leaves `infra/cdk.out/Jarvel-staging.template.json`.
- `frontend/dist/`, `infra/cdk.out/` and `coverage/` are ignored by git. Do not commit them.

## Running the Tests

The unit tests are described in `../code-generation/unit-test-instructions.md`. The whole suite, with coverage for `backend` and `infra`, is:

```bash
npm test
```

It fails if line coverage in `backend` or `infra` drops below 80%. That threshold must never be lowered to make a run pass.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `npm ci` fails with an engine error | Node is older than 22. Install Node 22 or later. |
| Step 6 stops with `Invalid CDK context` | `alertEmail` is missing or is not an email address, or `stage` is not `staging` or `prod`. Pass both with `-c`. |
| Step 5 warns that a chunk is larger than 500 kB | Expected. The large chunk is the Cognito sign-in code, which loads only when the web app is pointed at a deployed API. |
| `npm run format:check` fails after you edit a file | Run `npm run format`, then check again. |
| A test fails with a coverage threshold message | A change removed tested code or added untested code. Add tests. Do not lower the threshold. |
| `npm run validate:data` exits non-zero | A data file has a broken reference or a bad time. The output names the file and the path of each problem. |
