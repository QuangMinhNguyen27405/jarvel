# Team-Level Rules

> This team's affirmed practices and corrections. Loaded after `org.md` as
> strict-additive guidance; contradictions with broader policy are rejected.
> Populated by the practices-discovery affirmation gate. Edit at the gate,
> not directly.

## Way of Working

- We are one builder working with AI help. There is no second reviewer, so the builder approves their own pull requests and the CI result is the check.
- We use trunk-based development. `main` on GitHub (`origin`) is the only long-lived branch.
- Every change starts on a short-lived branch from `main` and comes back through a GitHub pull request within one to two days.
- A pull request merges only when CI passes. We squash-merge it, so each piece of work becomes one commit on `main`, named after that work.
- For Construction work, the branch base is `main` and the merge target is `main`.
- Environments are kept apart by deployment configuration, never by long-lived release branches.
- The repository is an npm-workspaces monorepo (`shared`, `backend`, `infra`, `frontend`). Branch and change names say which package they touch.

## Walking Skeleton

- We build a thin end-to-end slice first: the smallest version that runs the whole way through, built to prove the pieces connect before the real features go in.
- The slice is a request to the API deployed in our AWS account that returns a basic plan. It is our target for the Nov 1, 2026 milestone (a first working plan for the requester's own Boston trip).
- A slice that only runs on the builder's machine does not count. The slice is done only when the recorded, human-approved verification command shows that deployed end-to-end result and the builder approves the checkpoint. A design review alone does not count.
- Real features are built on top of the slice only after that approval.

## Testing Posture

- **Methodology**: test-after
- **Methodology evidence**: The builder chose test-after in the practices-discovery interview (Q3, option A). The repository has no tests yet, so there was no existing habit to keep or replace. Vitest is already declared in `backend`, `infra` and `frontend`.
- **Ordering**: Implement each testable layer first, then write and run that layer's tests before moving on to the next layer.
- Coverage floor: at least 80% line coverage, checked in CI before a pull request can merge.
- Test volume and types follow the intent's Test Strategy (Standard).
- Test runner: Vitest in every package that has code. Coverage reports go to `coverage/`, which git ignores.
- The automated test suite uses fakes for every paid AWS service and for the AI model, so test runs cost nothing against the $25-per-month cap.
- The only check against real AWS is a short smoke check against the real deployment after each deploy.
- The type check (`npm run typecheck`) and the test suite (`npm test`) both have to pass. Today both fail (no workspace `tsconfig.json`, no test files), so Construction first makes them pass to set a baseline.
- Frontend test tooling (jsdom, Testing Library) is declared but not used in this version, because the traveler web app is out of scope.

## Guard Policy

<!-- Affirmed by the team. Mode: strict, relaxed, or off. Strict here holds for every intent, whatever one person asks in chat; relaxed or off here applies to every intent whose policy came from its scope, unless project.md or the person sets another; changing this line changes it. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

- We deploy to the builder's existing AWS account with AWS CDK v2 (`infra`), and running cost stays under $25 per month.
- There are two environments in that one account: staging and production.
- GitHub Actions runs the pipeline. CI (type check, lint, format check, tests with coverage) runs on every pull request.
- Every merge to `main` deploys to staging automatically.
- Production deploys only after the builder approves it explicitly. Before approving, the builder reads the infrastructure (CDK) diff, especially any IAM, network access or encryption change.
- We do not deploy with `cdk deploy --require-approval never`; the pipeline's approval step replaces it.
- After every deploy, a short smoke check against the real deployment confirms it worked. If it fails, we roll back to the previous version. Every deployment has written rollback steps.
- Deploy output files such as `cdk-outputs.json` are never committed.

## Code Style

- Prettier formats the code, configured to match the existing style: single quotes, semicolons, two-space indentation, print width 120.
- ESLint checks the code with the typescript-eslint recommended rules.
- Both are configured at the repository root and run in CI. A format or lint failure blocks the merge.
- TypeScript is strict everywhere: every workspace extends `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`, ES modules).
- Naming follows TypeScript conventions: PascalCase types, camelCase fields and functions, and kebab-case IDs. We prefer string-literal unions to enums, and write relative imports with a `.js` extension.
- Shared contract types live in `@jarvel/shared`. Every package that uses them imports them from there and declares the dependency.
- The runtime floor is Node.js 22.
## Forbidden

<!-- Team-specific forbidden patterns -->

## Mandated

<!-- Team-specific mandates -->

## Corrections

<!-- Self-learning loop appends here. -->
