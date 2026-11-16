# Code Structure

## Repository Layout (on disk, excluding `node_modules/`, `.git/` and AI-DLC folders)

```
jarvel/
├── .gitignore            node_modules, dist, cdk.out, *.tsbuildinfo, .env*, frontend/public/config.json, coverage
├── README.md             one-line title (the only file in commit 1eb3610)
├── package.json          workspace root: workspaces, engines, scripts
├── package-lock.json     lockfile v3
├── tsconfig.base.json    shared strict compiler options (no workspace extends it yet)
├── docs/
│   └── ARCHITECTURE.md   target design, context only (not implemented)
├── shared/
│   ├── package.json      @jarvel/shared, exports ./src/index.ts
│   └── src/
│       ├── index.ts      export * from './types.js'
│       └── types.ts      386 lines, all type and interface declarations
├── backend/
│   └── package.json      @jarvel/backend (no source)
├── infra/
│   └── package.json      @jarvel/infra (no source)
└── frontend/
    └── package.json      @jarvel/frontend (no source)
```

## File Classification

| File | Category | Notes |
|---|---|---|
| `shared/src/types.ts` | Model/Entity | Domain, API and workflow contract types; no runtime code |
| `shared/src/index.ts` | Configuration (barrel) | Re-exports the types |
| `package.json`, `*/package.json`, `tsconfig.base.json`, `package-lock.json` | Configuration | Build and dependency manifests |
| `.gitignore` | Configuration | |
| `README.md`, `docs/ARCHITECTURE.md` | Documentation | |

Categories with no files: Controller/Handler, Service, Repository, Middleware, Utility, Test, Migration, Static/Asset.

## `shared/src/types.ts` Sections

| Lines | Section | Main exports |
|---|---|---|
| 5-172 | Static knowledge base | `DayKey`, `PlaceCategory`, `Money`, `Place`, `LineId`, `Line`, `Station`, `Edge`, `TransitNetwork`, `RiskLevel`, `SafetyArea`, `SafetyKnowledge`, `TripDefaults`, `WishlistEntry`, `HotelInfo` |
| 174-249 | API trip request and plan records | `Pace`, `SafetyStrictness`, `BudgetLevel`, `TripPreferences`, `TripRequest`, `ReviseRequest`, `AgentName`, `AgentStatus`, `AgentProgress`, `PlanStatus`, `PlanRecord`, `PlanSummary` |
| 251-338 | Itinerary output | `TransitStep`, `TransitLeg`, `ItineraryItem`, `WeatherSummary`, `DayPlan`, `CostBreakdown`, `CriticIssue`, `Itinerary` |
| 340-371 | HTTP API | route list (comments), `CatalogResponse`, `CreatePlanResponse`, `FrontendConfig` |
| 373-385 | Step Functions state | `StepState` |

The comment at line 6 points to `backend/src/data/*.json` as the curated knowledge base. That folder does not exist.

## Code Patterns
- **Contract-first shared types**: a single source-only package that every other workspace is meant to import.
- **String-literal unions in place of enums** (`PlanStatus`, `LineId`, `AgentName`, and others). These work with `isolatedModules` and add no runtime output.
- **Inline documentation of formats and foreign keys** (`safetyAreaId // -> SafetyArea.id`, `"HH:MM"`), with no runtime validation.
- **Derived types** (`PlanSummary = Pick<PlanRecord, …>`, `ReviseRequest & { at; version }`).
- Naming follows TypeScript conventions: PascalCase types, camelCase fields, kebab-case IDs in comments.

## Dependency Adjacency (source files)

- `shared/src/index.ts` → `shared/src/types.ts`
- `shared/src/types.ts` → none
- No circular references (only two source files exist).
