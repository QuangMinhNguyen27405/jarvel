# Jarvel

Jarvel plans a trip to Boston. You give it your arrival and departure, your hotel and a wishlist of places, and it
answers with a day-by-day plan: which places on which day, at what time, and how to get between them by subway. Every
stop is inside the place's opening hours, and the plan follows fixed safety rules for where you are after dark.

It has two parts:

- **An invite-only API** on AWS: API Gateway, Cognito sign-in, two Lambda functions, DynamoDB and one AI call per
  plan, to the Anthropic API or to Amazon Bedrock (`backend/README.md`, "AI provider").
- **A web app** (React) that signs you in, takes the trip details and shows each day of the plan on a map.

> **The Boston data is a SAMPLE.** The places, opening hours, subway data and safety areas in `backend/src/data/` are
> not hand-checked. A plan that keeps to those hours can still arrive at a closed door, and the safety areas are
> placeholders. Do not rely on a plan until the data has been replaced with checked information
> (see [Replacing the sample Boston data](backend/README.md#replacing-the-sample-boston-data)).

## Status

As of 2026-11-15:

- The API, the infrastructure code, the web app and a local server are built and tested.
- Everything runs on your own computer with no AWS account and no cost (see [Try it locally](#try-it-locally)).
- The AWS stack has **not been deployed yet**.
- The CI and deploy workflows are in `.github/workflows/`, but they have **not run yet**: this work is not pushed to
  GitHub, and the pipeline's sign-in to AWS is not set up.

## Try it locally

You need Node.js 22 or later.

```sh
npm ci
npm run dev -w @jarvel/backend        # API on http://localhost:8787
npm run dev -w @jarvel/frontend       # web app on http://localhost:5173 (second terminal)
```

Open <http://localhost:5173> and click **Use the demo account**. It already has one trip, so you can look at a
finished plan without filling in the form. You can also sign in with any name and create your own trip.

What is different from the real thing:

- **Sign-in is fake.** Any name or email address works, and nobody is emailed.
- **Nothing is saved.** The data is in memory and is gone when the server stops.
- **The AI model is a scripted stand-in**, so no Bedrock call is made. The scheduling, subway routing, safety rules
  and final check are the real code.
- **Only this computer can reach it.** The API listens on `127.0.0.1`.
- **The maps need the internet.** Locally they are drawn from OpenStreetMap tiles. With a deployed stack's maps key
  they are drawn from Amazon Location (see
  [Using the web app with a deployed API](#using-the-web-app-with-a-deployed-api)).

The local server must never be deployed, because it has no real sign-in. The settings (`PORT`, `HOST`,
`DEV_PLANNER_DELAY_MS`, `DEMO_EMAIL`, `DEV_SEED_DEMO`) and the demo account are described in
[Running locally](backend/README.md#running-locally).

## How a plan is built

1. `POST /plans` checks the request, counts it against your **3 plans per calendar month** and answers `202` at once.
2. The planner function makes one AI call. The AI only chooses which places go on which day and in what order.
3. Fixed code sets the times, routes each leg over the stored subway network, and applies the opening-hours and
   safety rules.
4. A final check refuses any plan that breaks a rule. A refused or failed plan gives its monthly count back.
5. You poll `GET /plans/{planId}` until the plan is `SUCCEEDED` or `FAILED`. A plan can be read as JSON or Markdown.

Wishlist entries that cannot be placed are listed as not scheduled, each with a reason.

## Repository layout

The repository is an npm-workspaces monorepo.

| Folder     | Package            | What it holds                                                                                |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `shared`   | `@jarvel/shared`   | The types and constants the other packages share.                                            |
| `backend`  | `@jarvel/backend`  | The API and planner Lambda code, the Boston data, the admin script and the local server.     |
| `infra`    | `@jarvel/infra`    | The AWS CDK v2 stack: one stack per stage (`Jarvel-staging`, `Jarvel-prod`) in `us-east-1`.  |
| `frontend` | `@jarvel/frontend` | The web app: React, Vite and MapLibre maps, with Cognito sign-in through Amplify.            |
| `aidlc`    | none               | The AI-DLC workflow records for this work: requirements, the code plan and the reviews.      |
| `docs`     | none               | `ARCHITECTURE.md`, an earlier design sketch. It describes more than was built; see the note. |

**Note on `docs/ARCHITECTURE.md`:** it was written before the build and differs from the code (for example, it
describes separate agents and files that do not exist). The code and [`backend/README.md`](backend/README.md) are the
reference.

## Commands

Run these from the repository root.

| Command                            | What it does                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck`                | Type-checks all four packages.                                                  |
| `npm run lint`                     | ESLint over `shared`, `backend` and `infra`.                                    |
| `npm run format:check`             | Prettier check (`npm run format` rewrites). It skips `frontend/` and `docs/`.   |
| `npm test`                         | Vitest for `backend`, `infra` and `frontend`.                                   |
| `npm run validate:data`            | Checks the Boston data files and fails on any error.                            |
| `npm run build:frontend`           | Type-checks and builds the web app.                                             |
| `npm run dev -w @jarvel/backend`   | Runs the API locally on port 8787.                                              |
| `npm run dev -w @jarvel/frontend`  | Runs the web app locally on port 5173.                                          |
| `npm run synth`                    | Validates the data, then synthesizes the CDK stack (needs `-c alertEmail=...`). |
| `npm run deploy`                   | Validates the data, then deploys the stack. Read [Deploying](#deploying) first. |
| `npm run admin -w @jarvel/backend` | Invites, disables or deletes an account, with your own AWS credentials.         |

## Tests

- The automated tests make **no AWS or AI calls**. DynamoDB, Lambda, Cognito, Parameter Store, Bedrock and the
  Anthropic API are all faked.
- `backend` and `infra` fail below **80% line coverage**. The local server script is left out of the coverage
  count. Coverage reports go to `coverage/`, which git ignores.
- The only check against real AWS is the short
  [smoke check](backend/README.md#post-deploy-smoke-check) you run by hand after a deploy.

## Deploying

Each stage is one CloudFormation stack in `us-east-1`. `alertEmail` is required.

```sh
npm ci
npm run validate:data
npm run diff -w @jarvel/infra -- -c stage=staging -c alertEmail=you@example.com
npm run deploy -w @jarvel/infra -- -c stage=staging -c alertEmail=you@example.com
```

- **Read the diff before every deploy**, especially IAM, network access and encryption changes. Do not skip the
  confirmation with `--require-approval never`.
- The stack creates the user pool, the plans table, the two functions, the HTTP API, two alarms with an email
  alert, a maps key for the web app, and a budget that emails you when the account's spend passes **$20** of the
  **$25** monthly cap.
- The maps key can only read Amazon Location map tiles, and only from a page at `http://localhost` (any port). To
  allow other addresses, list up to five, with `*` as a wildcard:
  `-c "mapReferers=https://your-site.example/* http://localhost:*"`.
- The stack does not host the web app. To use the web app with a deployed API, see the next section.
- Accounts are invite-only. After deploying, invite people with the
  [admin script](backend/README.md#admin-script).

The full steps, the smoke check, the rollback steps and the cost model are in
[`backend/README.md`](backend/README.md#deploying).

### The pipeline

The workflow files in `.github/workflows/` describe the intended path. They have not run yet.

- **Every pull request to `main`** runs the checks: type check, lint, format check, data check, tests with coverage,
  the web app build and a local build of the infrastructure template (`ci.yml`).
- **Every merge to `main`** runs the checks again, deploys staging and runs a short smoke check. It then shows the
  production diff and waits for your approval before deploying production (`deploy.yml`, `deploy-stage.yml`).
- **A change that broadens permissions or network access stops the pipeline.** You deploy that change by hand with
  the commands above, after reading the diff. The first deploy of each stage is such a change.
- The pipeline signs in to AWS with GitHub's short-lived sign-in (OIDC), so no AWS key is stored in GitHub. The
  one-time setup is in
  [`cd-config.md`](aidlc/spaces/default/intents/261017-jarvel-backend-api/operation/deployment-pipeline/cd-config.md),
  and the rollback steps are in
  [`rollback-runbook.md`](aidlc/spaces/default/intents/261017-jarvel-backend-api/operation/deployment-pipeline/rollback-runbook.md).

### Using the web app with a deployed API

Create `frontend/public/config.json` from the stack outputs, then run the web app as usual. Git ignores this file.

```json
{
  "region": "us-east-1",
  "apiUrl": "https://abc123.execute-api.us-east-1.amazonaws.com",
  "userPoolId": "us-east-1_XXXXXXXXX",
  "userPoolClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "mapsApiKey": "v1.public.xxxxxxxx"
}
```

`apiUrl` is the `ApiUrl` output without the trailing slash. With this file the web app shows the real Cognito
sign-in. Without it, or with `"mock": true`, the web app runs in local mode.

`mapsApiKey` makes the maps Amazon Location's. Leave it out and they stay OpenStreetMap. The stack outputs only the
key's name (`MapsApiKeyName`), so read its value with:

```sh
aws location describe-key --key-name jarvel-staging-maps --query Key --output text
```

- The key is a browser key: anyone who opens the page can read it. That is why the stack limits it to reading map
  tiles from the listed addresses, and why it gives no access to any Jarvel data.
- Open the web app at `http://localhost:5173`, not `http://127.0.0.1:5173`. Amazon Location refuses the key for an
  address the stack does not list, and the maps then fall back to OpenStreetMap with one line in the browser
  console.
- `"mapStyle"` picks the look: `Standard` (the default), `Monochrome`, `Hybrid` or `Satellite`.

## Rules for this repository

- Never commit `.env` files, credentials, or deploy outputs such as `cdk-outputs.json`.
- Never call a paid AWS service, including the AI model, from the automated tests.
- Import shared types from `@jarvel/shared`, and declare it as a dependency in every package that uses it.
- The type check and the full test suite both have to pass before a change merges to `main`.

## More detail

[`backend/README.md`](backend/README.md) covers every endpoint with examples, the opening-hours rules, the admin
script, replacing the sample data, the cost model, deploying, the smoke check and rollback.
