# API Documentation

## Status

**No API is implemented.** No HTTP handler, router, Lambda entry point, API Gateway definition or OpenAPI file exists. The only API surface is a contract **declared in comments and types** in `shared/src/types.ts` (lines 340-371). The table below documents that declared contract so later stages can confirm, trim or replace it. It is not live behaviour.

## Declared HTTP Contract (`shared/src/types.ts` lines 341-349)

Line 341 declares the auth model: "API Gateway HTTP API, JWT authorizer = Cognito access token". Nothing enforces it.

| Method | Path | Request body | Declared response | In approved scope? |
|---|---|---|---|---|
| GET | `/catalog` | none | `CatalogResponse` `{ places, defaults, stations, lines, safetyAreas }` | Unclear (exposes curated data) |
| POST | `/plans` | `TripRequest` | `202 CreatePlanResponse` `{ planId, version, status }` | Yes (core must-have) |
| GET | `/plans` | none | `{ plans: PlanSummary[] }` | Should-have ("past plans") |
| GET | `/plans/{planId}` | none | `PlanRecord` | Yes (needed to read a plan) |
| POST | `/plans/{planId}/revise` | `ReviseRequest` | `202 { planId, version, status }` | **No** (revise is out of scope) |
| DELETE | `/plans/{planId}` | none | `204` | Unclear (relates to the open question on deleting personal data) |

**Errors** (line 349): `{ error: string }` with a 4xx or 5xx status. No error code, field details or request id are defined.

**Not declared anywhere in code**: pagination for `GET /plans`; status codes other than 202 and 204; rate-limit or quota responses (for example 429 when the per-person monthly plan limit is reached); invitation or user-management endpoints; validation limits on `TripRequest` fields; versioning (no `/v1` prefix).

## Request and Response Types

| Type | Lines | Key fields |
|---|---|---|
| `TripRequest` | 194-203 | `title?`, `arrival`, `departure` (`YYYY-MM-DDTHH:MM`), `travelers`, `hotel: HotelInfo`, `wishlist: string[]`, `notes?`, `preferences: TripPreferences` |
| `TripPreferences` | 182-192 | `pace`, `safety`, `budgetLevel`, `transport` (`subway-first` or `mixed`), `maxWalkMinutes`, `dayStart`, `dayEnd`, `dietary?`, `includeMichelin` |
| `ReviseRequest` | 205-210 | `feedback`, `fromDate?`, `fromTime?`, `currentLocation?` |
| `PlanRecord` | 233-247 | `userId`, `planId`, `version`, `status`, `title`, `request`, `revisions[]`, `progress: AgentProgress[]`, `itinerary?`, `error?`, `executionArn?`, `createdAt`, `updatedAt` |
| `PlanSummary` | 249 | `planId`, `title`, `status`, `version`, `createdAt`, `updatedAt` |
| `Itinerary` | 328-338 | `summary`, `days: DayPlan[]`, `costs: CostBreakdown`, `safetyBrief[]`, `transitBrief[]`, `unscheduled[]`, `criticIssues[]`, `generatedAt`, `modelId` |
| `CatalogResponse` | 351-357 | `places`, `defaults`, `stations`, `lines`, `safetyAreas` |
| `FrontendConfig` | 365-371 | `region`, `apiUrl`, `userPoolId`, `userPoolClientId`, `mock?` (for the web app, which is out of scope for this version) |

## Internal Contracts

| Contract | Lines | Purpose |
|---|---|---|
| `StepState` | 378-385 | Small state passed between workflow steps: `userId`, `planId`, `version`, `iteration`, `needsRevision?`, `error?` |
| S3 artifact key convention | 374-375 (comment) | `plans/{planId}/v{version}/{agent}[-{iteration}].json` |
| `crimeApi` descriptor | 136-143 | Describes an external data source (Analyze Boston CKAN `datastore_search_sql`). No client exists. |

## External APIs Referenced (no integration code)
- Analyze Boston CKAN datastore (named in the `SafetyKnowledge.crimeApi` field comment).
- `WeatherSummary.source: 'nws-forecast' | 'climatology'` implies the US National Weather Service. No client exists.
- Bedrock: implied by the `@aws-sdk/client-bedrock-runtime` dependency and `Itinerary.modelId`. No code exists.
