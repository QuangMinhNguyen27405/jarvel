# Jarvel — Boston multi-agent trip planner (AWS)

Traveler: Boston, **arrive 10:00 Wed Nov 18 2026**, **leave 15:00 Sat Nov 21 2026** (flight from BOS assumed).
Hotel: Holiday Inn Express Boston Logan Airport - Revere (Revere, MA; Blue Line side). Travels mainly by subway.
Priorities: **safety** (avoid high-crime areas, esp. after dark) → **unhurried pace** → **subway** → **cost estimate**.

## Repo layout (npm workspaces, Node 22, TypeScript strict, ESM)

```
package.json            workspaces: shared, backend, infra, frontend; scripts: build, test, typecheck, deploy
tsconfig.base.json      strict, target ES2022, module ESNext, moduleResolution Bundler
shared/                 @jarvel/shared — src/types.ts + src/index.ts (re-export). package.json "exports": {".": "./src/index.ts"}; no build step
backend/                @jarvel/backend — Lambda handlers (bundled by CDK NodejsFunction/esbuild)
  src/data/places.json        Place[]
  src/data/transit.json       TransitNetwork
  src/data/safety.json        SafetyKnowledge
  src/data/defaults.json      TripDefaults
  src/lib/                    bedrock.ts (Converse + tool loop), router.ts (Dijkstra), geo.ts, time.ts, hours.ts,
                              validator.ts (deterministic critic checks), cost.ts, crime.ts, weather.ts, store.ts (DDB+S3), ids.ts, http.ts
  src/agents/                 one module per agent: researcher, safety, transit, scheduler, critic, budget (+ prompts)
  src/handlers/               api.ts (single HTTP API Lambda, routes by routeKey), step handlers (see below)
  test/                       vitest unit tests (no AWS calls; Bedrock mocked)
infra/                  @jarvel/infra — CDK v2 app (TypeScript), bin/jarvel.ts, lib/jarvel-stack.ts, test/
frontend/               @jarvel/frontend — React 18 + Vite + TS, aws-amplify v6 auth, Leaflet map
```

## AWS architecture (single stack `JarvelStack`, us-east-1)

- **Cognito User Pool** (email sign-in, self sign-up DISABLED, admin creates the user; strong password policy;
  optional TOTP MFA). App client: public (no secret), SRP + refresh, access-token validity 1h.
- **HTTP API (API Gateway v2)** with CDK `HttpUserPoolAuthorizer` (user pool + app client). Frontend sends the
  Cognito **access token** as `Authorization: Bearer <token>`. All routes require auth, including `GET /catalog`.
  CORS: allow origin = CloudFront domain + `http://localhost:5173`, headers `authorization,content-type`.
  Default stage throttling: rate 5 rps, burst 10.
- **Lambda `ApiFn`** (Node 22, arm64, 512MB, 15s): handles all routes; starts Step Functions executions.
- **Step Functions Standard state machine `PlannerMachine`** (timeout 20 min), each Task = a Lambda (arm64, 1024MB,
  5 min timeout, retry on `Lambda.TooManyRequestsException`, `ThrottlingException`, `States.Timeout` x2 backoff):
  ```
  MarkRunning
  → Parallel[ Researcher , Safety , Transit ]          (independent, run concurrently)
  → Scheduler (iteration n)
  → Critic   (deterministic validator + LLM review)  → Choice: blockers && n < 2 → Scheduler (n+1) with critic feedback
  → Budget
  → Finalize (assemble Itinerary, save, status SUCCEEDED)
  Catch-all → MarkFailed (status FAILED, error message)
  ```
  State passed between steps is SMALL: `{ userId, planId, version, iteration, artifacts: { [agent]: s3Key } }`.
  Each agent reads inputs from / writes its JSON output to **S3 `ArtifactsBucket`** at `plans/{planId}/v{version}/{agent}[-{iteration}].json`
  (lifecycle: expire after 30 days). Avoids the 256KB Step Functions payload limit.
- **DynamoDB `PlansTable`** — PK `userId` (S), SK `planId` (S); on-demand; PITR on. Holds PlanRecord (itinerary inline;
  if > 350KB store in S3 and set `itineraryS3Key`). Progress updates: each agent sets its `progress[]` entry
  (running → done/failed + one-line summary) so the UI shows live agent activity.
- **S3 `SiteBucket`** (private, BlockPublicAccess) + **CloudFront** distribution with OAC, default root `index.html`,
  SPA fallback (403/404 → /index.html 200), HTTPS redirect, security headers policy. `BucketDeployment` uploads
  `frontend/dist` plus a generated `config.json` (FrontendConfig) — frontend fetches `/config.json` at startup.
- **Bedrock**: Converse API with tool use. Model id from env `MODEL_ID` (CDK context `modelId`,
  default `us.anthropic.claude-sonnet-5-5`); IAM `bedrock:InvokeModel*` + `bedrock:Converse*` on the inference profile
  and underlying foundation-model ARNs in all US regions (cross-region inference profile).
- Observability: Lambda log retention 2 weeks, X-Ray tracing on Lambdas + state machine, a CloudWatch alarm on
  state machine ExecutionsFailed (no SNS needed).
- Outputs: SiteUrl, ApiUrl, UserPoolId, UserPoolClientId, StateMachineArn.

## Agents (backend/src/agents)

All LLM agents use `runAgent({ system, prompt, tools, outputSchema, maxTurns })` in `lib/bedrock.ts`:
Converse loop executing local tool functions until the model calls the final `submit_result` tool whose JSON
input is validated against `outputSchema` (zod). Retries invalid output up to 2 times. Temperature 0.3.
Tools are plain TS functions; the tool spec JSON schema is derived from zod.

| Agent | Inputs | Tools | Output (S3 artifact) |
|---|---|---|---|
| **researcher** | TripRequest, places.json, defaults.json | `search_catalog(query, category?)`, `get_place(id)`, `check_open(placeId, date, time)` | `{ selected: {placeId, priority: 'must'|'want'|'optional', reason}[], unresolved: {original, reason}[], suggestions }` — resolves every wishlist entry (fuzzy names like "tate bakery" → Tatte), adds well-known attractions, 1 Michelin-starred option if includeMichelin, ≥2 Vietnamese options, Chinatown, Harvard + MIT, a park |
| **safety** | TripRequest, safety.json | `get_area_safety(areaId)`, `crime_stats(district, days)` (live Analyze Boston CKAN query; graceful fallback to curated data on error/timeout 4s) | `{ areaRules: {areaId, dayRisk, nightRisk, avoidAfter?, note}[], brief: string[] }` |
| **transit** | TripRequest, transit.json, hotel | `route(fromStationId, toStationId, departTime)` (deterministic Dijkstra), `nearest_station(lat,lng)` | `{ passAdvice, arrivalPlan, departurePlan (hotel→BOS by 15:00 flight → leave hotel ≤ 12:30), brief: string[], lastTrainCautions }` |
| **scheduler** | researcher + safety + transit artifacts, weather, prefs, previous itinerary + critic issues (+ ReviseRequest) | `route`, `get_place`, `check_open`, `get_area_safety` | `{ days: DayPlan[] (without transit legs filled is OK), unscheduled[] }` — geographic clustering per day (e.g. Cambridge day, Back Bay/Common day, Downtown/North End/Chinatown day) |
| **critic** | scheduler draft | deterministic `validator.ts` first, then LLM review | `{ issues: CriticIssue[], blockers: number }` |
| **budget** | final days | deterministic `cost.ts` + LLM for notes | CostBreakdown |

**Finalize** (deterministic): fill every transit leg between consecutive located items with `router.route` (walk if ≤ maxWalkMinutes
and < 1.2 km; else subway; if after `avoidAfter` of an area or after last train → rideshare leg with reason), recompute times
so nothing overlaps, compute walkingMinutes and costs, attach weather, write Itinerary.

### Deterministic validator rules (validator.ts) — the "safety + not rushy" guarantees
- **hours**: every visit/meal is inside the place's opening hours for that weekday (with ≥ dwell time before close).
- **pace**: relaxed ⇒ ≤ 3 major visits/day + meals, ≥ 30 min slack between items, a rest block ≥ 45 min if day > 8h;
  moderate ⇒ ≤ 4 visits, ≥ 15 min slack; packed ⇒ ≤ 6, ≥ 10 min.
- **walking**: no single walk leg > maxWalkMinutes; total walking ≤ 90 min/day (relaxed), 120 (moderate).
- **safety**: no item in an area with `nightRisk = 'elevated'` after sunset (~16:20 in late Nov) or after `avoidAfter`;
  in strict mode also no 'moderate' nightRisk after 20:00; back at hotel by `dayEnd`; last leg to hotel before Blue Line last train.
- **timing**: day 1 starts ≥ 10:00 + arrival logistics (BOS → hotel drop bags ~45-60 min); last day: at BOS by 13:00 for 15:00 flight
  (so last activity ends ≤ 11:45 near the Blue Line or airport).
- **wishlist**: every 'must' item scheduled or listed in `unscheduled` with a reason.

### Live data
- Weather: api.weather.gov (`/points/{lat},{lng}` → forecast) when date ≤ 7 days away, else `defaults.novemberClimate`
  (User-Agent header required: "jarvel-trip-planner (contact: admin)"). 4s timeout, fallback to climatology.
- Crime: Analyze Boston CKAN `datastore_search_sql` on the Crime Incident Reports resource; count incidents by district for
  the last 90 days with offense groups relevant to visitors; used to annotate/escalate curated risk, never to downgrade it.

## API Lambda behaviour
- `userId` = `event.requestContext.authorizer.jwt.claims.sub`.
- POST /plans: validate with zod (dates within Nov 2026 trip, travelers 1-10, wishlist ≤ 40 entries, strings ≤ 500 chars,
  notes ≤ 2000), create PlanRecord (QUEUED, progress all 'pending'), StartExecution with name `{planId}-v{version}`.
- Rate limit: max 20 plan generations (create+revise) per user per day (counter item `userId`, `planId = "#quota#YYYY-MM-DD"`, TTL).
- POST /plans/{id}/revise: requires SUCCEEDED or FAILED status, increments version, appends revision, starts execution.
- GET /plans/{id}: returns the record (resolve itineraryS3Key if set). 404 if not owned.

## Frontend UX
1. Sign in (Amplify `Authenticator`, `hideSignUp`).
2. **Trip setup** (prefilled from `/catalog` defaults): dates/times, hotel card, wishlist chips (the traveler's original items
   pre-resolved, add/remove, free text), preference controls (pace, safety strictness, budget, max walk, day start/end,
   Michelin toggle, dietary, notes). "Generate plan with AI agents".
3. **Agent activity panel**: live progress (poll GET /plans/{id} every 3s while QUEUED/RUNNING) — one row per agent with status
   pill, iteration, summary.
4. **Itinerary view**: day tabs; timeline cards (visit/meal/transit with line-colored badges, step instructions, safety badge,
   cost, booking tip, wishlist star); per-day weather, walking minutes, pace note, cost; Leaflet map (OSM tiles) of the day's stops
   + safety area circles colored by risk; Cost summary table + pass advice; Safety brief; Transit brief; Unscheduled list.
5. **Revise** box: free-text feedback + optional "replan from (date/time/current location)" → POST revise → shows new version.
6. Plans list (history), delete. Print-friendly CSS. Mobile-first responsive (used on the phone while in Boston).
