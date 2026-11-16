# Jarvel backend

The Boston trip-planning API: an HTTP API on API Gateway with Cognito sign-in, `ApiFn` for every route and
`PlannerFn` for building plans with one AI call, to the Anthropic API or to Amazon Bedrock (see
[AI provider](#ai-provider)). The infrastructure is in `../infra` (AWS CDK) and the shared types are in `../shared`
(`@jarvel/shared`).

> **The Boston data in `src/data/` is a SAMPLE.** It is marked `sample: true`, every place is `verified: false`, and
> the safety areas are placeholders. It exists so the tests and the first deploy have something to run on. It is
> **not checked safety or transit information**. Replace it with your own hand-checked data before anyone relies
> on a plan (see [Replacing the sample Boston data](#replacing-the-sample-boston-data)).
>
> Six of its places (`userRequested: true`) were added on 2026-11-12 from a web search, for the demo trip. Their
> addresses, coordinates and opening hours are **not hand-checked**: a plan that keeps to those hours can still
> arrive at a closed door. Check each one before you go.

## Commands

Run these from the repository root.

| Command                          | What it does                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run typecheck`              | Type-checks `shared`, `backend`, `infra` and `frontend`.                                          |
| `npm run lint`                   | ESLint over `shared`, `backend` and `infra`.                                                      |
| `npm run format:check`           | Prettier check (`npm run format` rewrites).                                                       |
| `npm test`                       | Vitest for `backend`, `infra` and `frontend`; `backend` and `infra` fail below 80% line coverage. |
| `npm run validate:data`          | Checks the Boston data files; fails on any error.                                                 |
| `npm run synth`                  | Validates the data, then synthesizes the CDK stack (needs `-c alertEmail=...`, see Deploying).    |
| `npm run dev -w @jarvel/backend` | Runs the API locally on `http://localhost:8787` with no AWS (see Running locally).                |

The automated tests make **no AWS or AI calls**: DynamoDB, Lambda, Cognito, Parameter Store, Bedrock and the
Anthropic API are all faked, and the test environment uses dummy credentials.

## Running locally

The local server runs the real API and planner code with no AWS and no cost:

```sh
npm run dev -w @jarvel/backend        # API on http://localhost:8787
npm run dev -w @jarvel/frontend       # web app on http://localhost:5173 (second terminal)
```

- **Sign-in is fake.** Send `Authorization: Bearer dev-<name>` and you are the user `<name>`; the web app's local
  sign-in asks only for a name. The name is 1 to 80 of `A-Z a-z 0-9 . _ @ + -`, so an email address works; any
  other character is refused with `401`. Each name has its own plans and its own limit of 3 plans a month.
- **It starts with a demo account** that already has one trip (see [Demo account](#demo-account)).
- **Data is in memory** (the same fake table the tests use), so everything is gone when the server stops.
- **The AI model is a scripted stand-in** (unless you ask for the real one, see
  [Trying a real Anthropic key locally](#trying-a-real-anthropic-key-locally)). It picks the wishlist places and
  fills the days from the catalog, after
  `DEV_PLANNER_DELAY_MS` (default 3000) so you can watch a plan go from `QUEUED` to `SUCCEEDED`. The scheduling,
  transit, safety rules and final check are the real code.
- **Only this computer can reach it.** It listens on `127.0.0.1`. `HOST` changes that (for example `HOST=0.0.0.0`
  to try it from a phone on your network), but anyone on that network can then use it with any name.
- Each day of a finished plan shows a map in the web app. Locally it is drawn from OpenStreetMap tiles, loaded from
  the internet.
- `PORT` changes the port. **Never deploy the dev server**: it has no real sign-in.

### Trying a real Anthropic key locally

`DEV_AI=anthropic` makes the local server call the real Anthropic API in place of the stand-in, through the same
adapter a deployed stage uses. Use it to check a key before a deploy. The key is read from `ANTHROPIC_API_KEY` in
the terminal that starts the server. It is never written to a file, and it is gone when that terminal closes.

In Windows PowerShell:

```powershell
$key = Read-Host -AsSecureString 'Anthropic API key'
$env:ANTHROPIC_API_KEY = [System.Net.NetworkCredential]::new('', $key).Password
$env:DEV_AI = 'anthropic'
npm run dev -w @jarvel/backend
```

In a POSIX shell:

```sh
read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY   # paste the key and press Enter; nothing is shown
DEV_AI=anthropic npm run dev -w @jarvel/backend
```

- The start-up lines say which AI is in use. **Every plan is then a paid call**, and the demo trip is built when
  the server starts, so each start is one call (about a cent or less with the default model). `DEV_SEED_DEMO=0`
  starts without it.
- **The key works** when the log shows `"status":"SUCCEEDED"` with an `aiCostUSD` above 0, and the trip opens in
  the web app.
- **The key is refused** when the log shows `plan build failed` with `AnthropicAuthenticationError`. The plan ends
  `FAILED` and nothing is charged. `AnthropicNotFoundError` means the key's account cannot use the model.
- `DEV_AI` has to be set by name. A key that only happens to be in the environment is never used.
- `MODEL_ID` tries another Anthropic model, for example `MODEL_ID=claude-haiku-5-5`.
- To go back to the stand-in, close the terminal, or remove both variables
  (`Remove-Item Env:ANTHROPIC_API_KEY, Env:DEV_AI` in PowerShell).

```sh
curl -s -X POST http://localhost:8787/plans -H "Authorization: Bearer dev-amy" -H "Content-Type: application/json" \
  -d '{"arrival":"2026-12-02T10:00","departure":"2026-12-04T15:00","travelers":1,
       "hotel":{"name":"Hotel","address":"1 Example St","lat":42.3586,"lng":-71.0585},"wishlist":["New England Aquarium"]}'
curl -s http://localhost:8787/plans -H "Authorization: Bearer dev-amy"
```

### Demo account

The local server creates one account when it starts and builds a trip for it, so there is something to look at
without filling in the form.

- **The account** is the address in `DEMO_EMAIL`. Its default is written in `scripts/demo.ts` and nowhere else;
  set the `DEMO_EMAIL` environment variable to use another address. It is only a local sign-in name: it is not a
  Cognito account, nobody is emailed, and nothing is deployed. The start-up line prints it.
- **The trip** is "My Boston food trip": 2 travelers, the form's placeholder hotel, Wednesday 10:00 to Saturday
  15:00, with a wishlist of seven entries written the way a traveler typed them. Six are matched to places in the
  Boston data (some through a place's `aliases`, for example `Guilia` for Giulia) and scheduled inside their
  opening hours. The seventh, `Quin Long - Malatang Hotpot`, is not in the data, so the plan lists it as not
  scheduled with the reason `not in the Boston data`.
- **The dates** are Nov 18 to Nov 21, 2026 while that arrival is still ahead. After that the trip is the next
  Wednesday to Saturday whose arrival is at least a day ahead, so the demo keeps working.
- **It is built like any plan**: the request goes through the same `POST /plans` code, is validated, and uses one
  of the demo account's 3 plans for the month. The trip is ready `DEV_PLANNER_DELAY_MS` after start-up; until then
  it shows as waiting or building. If it cannot be built, the server logs `demo trip could not be built` and
  keeps running.
- **In the web app**, the local sign-in page shows a "Use the demo account" button when the server has a demo
  account. A finished plan shows a "Not scheduled" card for the entries that are not in the plan.
- **`GET /dev/demo`** needs no sign-in and exists only on the local server. It answers
  `{ "user": "<address>", "planId": "<id>" }`; `planId` is `null` until the trip's request has been accepted.
  Without a demo account it answers `{ "user": null, "planId": null }`.
- **`DEV_SEED_DEMO=0`** starts the server with no demo account and no plans.

```sh
curl -s http://localhost:8787/dev/demo
curl -s http://localhost:8787/plans -H "Authorization: Bearer dev-<the user from the line above>"
DEV_SEED_DEMO=0 npm run dev -w @jarvel/backend        # start empty
DEMO_EMAIL=someone@example.com npm run dev -w @jarvel/backend
```

## Endpoints

Every route except `GET /health` needs a Cognito **access token** in `Authorization: Bearer <token>`. Errors are
JSON `{ "error": "...", "code": "...", "fields"?: [{ "field": "...", "message": "..." }] }`. A plan that belongs
to someone else answers exactly like a plan that does not exist (404).

Set these once (the values come from the stack outputs, see [Deploying](#deploying)):

```sh
API=https://abc123.execute-api.us-east-1.amazonaws.com   # ApiUrl output, without the trailing slash
TOKEN=eyJ...                                             # an access token, see the smoke check below
```

### `GET /health`

No sign-in. Returns `{ "status": "ok" }` and nothing else.

```sh
curl -s "$API/health"
```

### `POST /plans`

Starts a plan and answers `202` at once with `{ planId, version, status: "QUEUED" }`. The plan is built in the
background; poll `GET /plans/{planId}`. Each accepted plan uses one of your **3 plans per calendar month**
(Boston time). A failed plan gives its count back; deleting a plan does not.

```sh
curl -s -X POST "$API/plans" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-trip-2026-11-18" \
  -d '{
    "title": "My Boston trip",
    "arrival": "2026-11-18T10:00",
    "departure": "2026-11-21T15:00",
    "travelers": 2,
    "hotel": { "name": "My hotel", "address": "1 Example St, Boston", "lat": 42.3586, "lng": -71.0585 },
    "wishlist": ["Boston Public Library", "New England Aquarium", "Harvard Yard"],
    "notes": "We like quiet places.",
    "preferences": { "pace": "moderate", "safety": "standard", "maxWalkMinutes": 15 }
  }'
```

- `arrival` and `departure` are Boston local times written `YYYY-MM-DDTHH:MM`. The trip is at most 7 days, starts
  in the future and no more than 12 months ahead.
- `title`, `notes` and `preferences` are optional. Omitted preferences default to `pace: moderate`,
  `safety: standard`, `budgetLevel: moderate`, `transport: subway-first`, `maxWalkMinutes: 15`,
  `dayStart: 09:00`, `dayEnd: 21:30`, `includeMichelin: false`.
- The hotel must be within a 30-minute walk of a station in the data. Unknown fields are refused.
- `Idempotency-Key` is optional (1–128 of `A-Z a-z 0-9 . _ : -`). Re-sending the same key and body within 24 hours
  returns the same plan (header `idempotent-replayed: true`) without using another count. The same key with a
  different body answers `409 idempotency-conflict`.

| Status | `code`                                        | Meaning                                                         |
| ------ | --------------------------------------------- | --------------------------------------------------------------- |
| 202    | none                                          | Accepted, status `QUEUED`.                                      |
| 400    | `invalid-request`, `invalid-json`             | `fields` names every bad field. Nothing is counted.             |
| 409    | `idempotency-conflict`, `request-in-progress` | Key reused with a different body / first request still running. |
| 413    | `request-too-large`                           | Body over 64 KB.                                                |
| 429    | `quota-exceeded`                              | Body also has `limit`, `used` and `resetsOn` (`YYYY-MM-DD`).    |
| 503    | `planner-unavailable`                         | The planner could not be started; the count was given back.     |

### `GET /plans/{planId}`

Returns the plan as JSON: `status` is `QUEUED`, `RUNNING`, `SUCCEEDED` or `FAILED`. A finished plan includes the
itinerary, its `aiCostUSD`, `durationMs`, `dataVersion` and `sourceCredits`. A plan still unfinished 5 minutes
after it was accepted is shown as `FAILED` with `failureKind: "timeout"` and its count is given back.

```sh
curl -s "$API/plans/$PLAN_ID" -H "Authorization: Bearer $TOKEN"
```

For Markdown, add `?format=markdown` or send `Accept: text/markdown`:

```sh
curl -s "$API/plans/$PLAN_ID?format=markdown" -H "Authorization: Bearer $TOKEN"
curl -s "$API/plans/$PLAN_ID" -H "Authorization: Bearer $TOKEN" -H "Accept: text/markdown"
```

### `GET /plans`

Lists your own plans, newest first: `{ "plans": [{ planId, title, status, version, createdAt, updatedAt, arrival,
departure }] }`. It never includes anyone else's plans. A plan still unfinished 5 minutes after it was accepted is
listed as `FAILED`, the same as when you open it.

```sh
curl -s "$API/plans" -H "Authorization: Bearer $TOKEN"
```

### `PATCH /plans/{planId}`

Renames your plan. The body is only `{ "title": "..." }` (1–120 characters after trimming); any other field is
refused, because the itinerary was built from the original request. Answers `200` with the plan (JSON, or Markdown
as for `GET`), `400 invalid-request` naming the field, or `404` for unknown plans and other people's plans. Renaming
does not use a count.

```sh
curl -s -X PATCH "$API/plans/$PLAN_ID" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{ "title": "Thanksgiving in Boston" }'
```

### `DELETE /plans/{planId}`

Deletes your plan: `204`, then `GET` answers `404`. Unknown plans and other people's plans answer `404`.

```sh
curl -s -X DELETE "$API/plans/$PLAN_ID" -H "Authorization: Bearer $TOKEN" -o /dev/null -w '%{http_code}\n'
```

## Opening hours

Every stop in a plan is inside the place's opening hours on that date. The AI only chooses which places go on
which day and in what order; fixed code sets the times, and the final check refuses any plan that breaks the rule.

- **A visit fits in one opening period.** It starts at or after opening and ends at or before closing, for the
  whole of the place's `typicalDwellMinutes`. A place with a lunch and a dinner period is visited in one of them,
  never across the gap.
- **A stop never starts before opening.** When you would arrive early, the leg to the place leaves later instead,
  so the spare time is not spent at a closed door. That later leg is used when it is allowed by the transit and
  safety rules and still starts the visit no more than 15 minutes after opening; otherwise the earlier leg is kept
  and the visit starts at opening.
- **The AI's order is kept when the wait is short.** A stop that can start within 30 minutes of arriving stays
  where the AI put it. Otherwise the stop of that day that can start earliest goes first, so a dinner-only place
  listed first comes after the places that are open in the morning.
- **A place closed on the AI's day is moved** to another day of the trip when it fits there.
- **What cannot be placed is listed, with a reason**, in `itinerary.unscheduled` (the "Not scheduled" section of
  the Markdown and the web app): `closed on your dates` when the place is closed on every date of the trip,
  `does not fit in your days` when it is open on some date but there is no room for it.
- **How `hours` is read**, per weekday (`mon` to `sun`), as `["HH:MM", "HH:MM"]` pairs:
  - a weekday that is missing means the hours are unknown, and nothing is limited on that day;
  - an empty list (`"sun": []`) means closed all day;
  - a closing time after midnight (`"26:00"`) counts up to 24:00, because no stop crosses midnight.
- **The final check** adds the rule `opening-hours`. A plan with a stop outside its hours is never shown; it fails
  like any other plan that breaks a rule, and its count is given back.

The rule is only as good as the data. The sample hours are not hand-checked (see the note at the top).

## Admin script

There is no admin API. The admin runs `scripts/admin.ts` locally with **their own AWS credentials**, which must be
allowed to call the Cognito admin actions on the pool and DynamoDB on the table. Anyone else is refused.

```sh
export AWS_REGION=us-east-1
export USER_POOL_ID=us-east-1_XXXXXXXXX   # UserPoolId output
export TABLE_NAME=Jarvel-staging-PlansXXXXXXXX   # TableName output

npm run admin -w @jarvel/backend -- invite person@example.com
npm run admin -w @jarvel/backend -- disable person@example.com
npm run admin -w @jarvel/backend -- delete-account person@example.com
npm run admin -w @jarvel/backend -- delete-account --sub 0a1b2c3d-...   # re-run the data cleanup by user id
```

- `invite` creates the user; Cognito emails them a temporary password, which they replace at first sign-in.
  Inviting an address that already has an account is refused and creates nothing.
- `disable` disables the user and signs them out everywhere. Their refresh tokens stop at once; an access token
  already issued keeps working until it expires, **at most 1 hour**.
- `delete-account` first writes a deleted marker for the user id, so the API refuses (401) any request from a
  token that is still valid, then signs the user out, deletes every plan and idempotency key, and deletes the
  Cognito user. The marker holds nothing but the user id and expires after 2 hours, longer than any access token
  lives; nothing else left in the table names their user id. Every write a plan request makes is checked against
  the marker in the same DynamoDB transaction, so a request already in flight when the marker is written cannot
  leave anything behind. The plans already counted this month are kept under a hash of the email address, so
  deleting and re-inviting the same person does not reset their monthly limit. If deleting the data fails, the
  Cognito user is kept so the command can be run again.
- `delete-account --sub <user id>` runs the data cleanup again for an account that is already deleted, without
  touching Cognito, for example after the first run stopped part-way. The first run prints the user id to use.

Exit codes: `0` done, `1` refused or failed, `2` wrong usage.

## Replacing the sample Boston data

The planner only uses the three files in `src/data/`:

- `places.json`: the places travelers can put on a wishlist, with opening hours (see
  [Opening hours](#opening-hours)), visit length, cost and the area. A place can list `aliases`: other spellings a
  traveler may type for it, such as a common misspelling. A wishlist entry matches an alias when they are equal,
  or when the alias is at least 5 characters long and appears in the entry as whole words.
- `transit.json`: subway lines with their service hours and headways, stations, the edges between stations
  (ride minutes) and the airport access.
- `safety.json`: areas with their bounds and their night risk (`low`, `moderate`, `elevated`) and optional
  `avoidAfter` time. Points outside every area count as unknown, which is treated as moderate after dark.

To replace them:

1. Edit the files with hand-checked information. Give each file a new `version` (it is stored with every plan as
   `dataVersion`) and update `sourceCredits` and `notice`.
2. When you have checked a place yourself, set its `verified` to `true`. When **all** the data is checked, set
   `sample` to `false` in each file; the warning then disappears from plans.
3. Run `npm run validate:data`. It checks every reference (place areas, stations, edges, airport station), that
   every time is `HH:MM`, that opening is before closing, and that no id is used twice. It prints each problem
   with its file and path, and exits non-zero on any error.
4. Run `npm test`. Some tests use the sample data's ids, so update them if you removed those places or stations.
5. Deploy. `npm run synth` and `npm run deploy` run `validate:data` first, so bad data never ships.

## Cost model and `MODEL_ID`

The total budget is **$25 a month** for everything, including tests and hosting. An AWS Budget emails the alert
address when actual spend passes **$20**.

- `MODEL_ID` is the model `PlannerFn` calls. The default is Claude Haiku 4.5 on either provider: `claude-haiku-4-5`
  on the Anthropic API, and `us.anthropic.claude-haiku-4-5-20251001-v1:0` (a US cross-Region inference profile) on
  Amazon Bedrock. Both are priced at **$1 per million input tokens and $5 per million output tokens**. Check these
  prices on the provider's pricing page before relying on them.
- Each plan makes one AI call, plus at most 2 retries when the answer is unusable or the AI service is busy. The
  scheduler, transit routing and safety checks are plain code and cost nothing per plan.
- **With the Anthropic API, the AI cost is billed by Anthropic, not AWS.** The AWS Budget does not see it, so it
  is outside the $20 alert. Set a spend limit for the key's workspace in the Anthropic Console.
- Each plan records its own cost in `aiCostUSD`: input tokens × input price + output tokens × output price, summed
  over every attempt. For example, 10,000 input and 1,500 output tokens at the default prices cost
  $0.0100 + $0.0075 = $0.0175.
- To use another model, deploy with `-c modelId=<id>` and give its prices so the recorded cost is right:
  `-c modelInputPricePerMTok=3 -c modelOutputPricePerMTok=15`. On Bedrock, the IAM policy then allows only that
  model. A model id that belongs to the other provider is refused when the stack is synthesized.
- **The maps in the web app are Amazon Location map tiles** once the web app has the stack's maps key, at **$0.04
  per 1,000 tiles** in `us-east-1` (AWS price list, November 2026). Opening one day's map loads fewer than a dozen
  tiles, and moving or zooming it loads more. This is AWS spend, so the Budget alert covers it. Without the key the maps
  are OpenStreetMap and cost nothing.
- Other cost guards: 3 plans per person per month, a 5 requests/second API throttle, on-demand DynamoDB and
  2-week log retention.

## AI provider

`aiProvider` in `infra/cdk.json` chooses where `PlannerFn` sends its AI call. It applies to every deploy, by hand
or from the pipeline. `-c aiProvider=<name>` overrides it for one command.

| `aiProvider`          | The call goes to                       | What it needs                                            |
| --------------------- | -------------------------------------- | -------------------------------------------------------- |
| `anthropic` (current) | The Anthropic API, `api.anthropic.com` | An Anthropic API key in Parameter Store, one per stage   |
| `bedrock`             | Amazon Bedrock in `us-east-1`          | Anthropic's one-time first-use form sent for the account |

The answer checks, the retries and the cost sum are the same code for both (`src/lib/ai.ts`); the Anthropic path is
an adapter in `src/lib/anthropic.ts`. Two things differ on the Anthropic path:

- The traveler's trip details (dates, wishlist, notes, dietary needs; never their email address) leave AWS and go
  to Anthropic, under the terms of the key's Anthropic account.
- No `temperature` is sent, because the current Anthropic API version rejects it. The model samples with its
  defaults; every answer is still checked against the catalog before it is used.

### Storing the Anthropic API key

The key is stored by hand, once per stage, as a SecureString parameter named `/jarvel/<stage>/anthropic-api-key`
in `us-east-1`, encrypted with the account's default `aws/ssm` key. The stack only holds the parameter's name and
lets `PlannerFn` read that one parameter. The key is never in the template, an environment variable, a log or git.

```sh
read -rs ANTHROPIC_KEY   # paste the key and press Enter; nothing is shown or kept in the shell history
aws ssm put-parameter --region us-east-1 --type SecureString \
  --name /jarvel/staging/anthropic-api-key --value "$ANTHROPIC_KEY"
unset ANTHROPIC_KEY
```

In Git Bash on Windows, put `MSYS_NO_PATHCONV=1` in front of `aws`. Without it, Git Bash rewrites the parameter
name as a Windows file path, and the key is stored under a name the planner never reads.

In Windows PowerShell:

```powershell
$key = Read-Host -AsSecureString 'Anthropic API key'
aws ssm put-parameter --region us-east-1 --type SecureString `
  --name /jarvel/staging/anthropic-api-key --value ([System.Net.NetworkCredential]::new('', $key).Password)
```

- Use a key made only for Jarvel, in its own Anthropic Console workspace with a spend limit, so it can be revoked
  without touching anything else. **Anyone with administrator access to the AWS account can read the parameter.**
- To replace the key, run the same command with `--overwrite`. `PlannerFn` reads the key when it starts and reads
  it again after Anthropic refuses it, so a replaced key needs no deploy.
- Until the parameter exists, every plan ends `FAILED` and its count is given back; the `PlannerFn` log names
  `ParameterNotFound`. A refused key is logged as `AnthropicAuthenticationError`.

## Deploying

Each stage (`staging`, `prod`) is one CloudFormation stack in `us-east-1`: `Jarvel-staging` or `Jarvel-prod`.
`alertEmail` is required; the stack fails to synthesize without it.

```sh
npm ci
npm run validate:data
npm run diff -w @jarvel/infra -- -c stage=staging -c alertEmail=you@example.com
npm run deploy -w @jarvel/infra -- -c stage=staging -c alertEmail=you@example.com
```

- **Store the Anthropic API key first** (see [Storing the Anthropic API key](#storing-the-anthropic-api-key)). The
  deploy itself does not need it, but no plan can be built without it.
- **Review the diff** before every deploy, especially IAM, network and encryption changes. The deploy asks you to
  confirm security-related changes; do not skip that with `--require-approval never`.
- After the first deploy, confirm the SNS email subscription (AWS sends a confirmation email to `alertEmail`).
- The stack outputs (`ApiUrl`, `UserPoolId`, `UserPoolClientId`, `TableName`, `MapsApiKeyName`) are written to
  `infra/cdk-outputs.json`. That file is git-ignored; **never commit it**, nor any `.env` file or credentials.
- Each stage creates its own budget, both covering the whole account, so with two stages you get two alert emails
  at $20.

## Post-deploy smoke check

Run this against each stage after every deploy. Use a test account you invited yourself.

1. **Health**: `curl -s "$API/health"` returns `{"status":"ok"}`, and `curl -s -o /dev/null -w '%{http_code}' -X POST "$API/plans"` returns `401`.
2. **Sign in** with your admin credentials (this flow works only with IAM permission for `AdminInitiateAuth`):

   ```sh
   aws cognito-idp admin-initiate-auth --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" \
     --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters USERNAME=tester@example.com,PASSWORD='...'
   ```

   A freshly invited account first answers with a `NEW_PASSWORD_REQUIRED` challenge; answer it with
   `aws cognito-idp admin-respond-to-auth-challenge --challenge-name NEW_PASSWORD_REQUIRED --session <Session> --challenge-responses USERNAME=tester@example.com,NEW_PASSWORD='...'`.
   Put `AuthenticationResult.AccessToken` in `TOKEN`.

3. **Create a plan** with the `POST /plans` example above; expect `202` and `"status":"QUEUED"`. Note the `planId`.
4. **Poll** `GET /plans/$PLAN_ID` every 15 seconds until `status` is `SUCCEEDED` or `FAILED`; it must finish
   within 5 minutes. A `FAILED` plan has a plain `error` reason; check the `PlannerFn` logs.
5. **Read the Markdown** with `?format=markdown`; it shows the days, the sample-data warning and the disclaimer.
6. **Delete** the plan; expect `204`, then `404` on `GET`.

The test plan uses one of the tester's 3 monthly plans and one real AI call.

## Rollback

Every deploy is the code of one commit. To roll back, check out the previous good commit and deploy it again:

```sh
git checkout <previous-good-commit>
npm ci
npm run validate:data
npm run diff -w @jarvel/infra -- -c stage=prod -c alertEmail=you@example.com
npm run deploy -w @jarvel/infra -- -c stage=prod -c alertEmail=you@example.com
```

Then run the smoke check again. The table and the user pool are kept (`RETAIN`) on stack updates and deletes, so a
rollback never loses plans or accounts; it changes only code and configuration. If a deploy fails part-way,
CloudFormation rolls the stack back to its previous state by itself.
