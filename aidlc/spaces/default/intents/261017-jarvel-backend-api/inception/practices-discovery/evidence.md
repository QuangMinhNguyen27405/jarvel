# Practices Discovery Evidence

> This was a lead-only run. The collaborators switch is off, so no support agent inspected anything and there are no contribution files. The lead wrote a draft from the evidence below, the builder answered eight interview questions (`practices-discovery-questions.md`) and confirmed the summary ("Looks correct"), and the lead then integrated those answers into `team-practices.md` and `discovered-rules.md`.

## Participants

| Participant | Role this run | Inspected |
|---|---|---|
| `aidlc-pipeline-deploy-agent` | Lead, sole author | Everything listed under "Sources inspected" |
| `aidlc-quality-agent`, `aidlc-developer-agent`, `aidlc-devsecops-agent` | Not dispatched (collaborators off) | Nothing |

## Sources Inspected

### Reverse-engineering knowledge base (upstream artifacts)

| Artifact | Path | What it contributed |
|---|---|---|
| code-structure | `aidlc/spaces/default/codekb/jarvel/code-structure.md` | Repository layout; only `shared/src/types.ts` and `shared/src/index.ts` hold code; no test files; naming patterns (PascalCase types, camelCase fields, string-literal unions) |
| technology-stack | `aidlc/spaces/default/codekb/jarvel/technology-stack.md` | Exact tool versions (TypeScript 7.0.2, Vitest 5.0.5, esbuild, Vite, AWS CDK 2.273.0 / CLI 2.1145.0, Node >=22); "Not Present" list: no linter, formatter, CI/CD, containers or migrations |
| dependencies | `aidlc/spaces/default/codekb/jarvel/dependencies.md` | `@jarvel/shared` is not declared by its consumers; root `synth`/`deploy` build the frontend first; `npm audit` not yet run; `@types/node` 26 vs Node 22 floor |
| code-quality-assessment | `aidlc/spaces/default/codekb/jarvel/code-quality-assessment.md` | Verified baseline (typecheck and test both fail); no tests, lint or CI; technical debt TD-1 to TD-11, especially TD-8 (`--require-approval never`), TD-9 (`cdk-outputs.json` not ignored), TD-11 (no lint/format/CI) |
| architecture | `aidlc/spaces/default/codekb/jarvel/architecture.md` | No architectural style established in code; AWS serverless only implied by dependencies; scripts verified to fail; architecture to be chosen in Inception |
| business-overview | `aidlc/spaces/default/codekb/jarvel/business-overview.md` | Scaffold stage, no capability delivered; approved scope is Boston-only, invite-only, backend API only |

### Workspace configuration

| File | Finding |
|---|---|
| `package.json` | npm workspaces `shared`, `backend`, `infra`, `frontend`; `engines.node >=22`; scripts `typecheck`, `test`, `build:frontend`, `synth`, `deploy` (deploy = frontend build, then infra deploy) |
| `tsconfig.base.json` | Strict compiler options (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `noEmit`, `moduleResolution: Bundler`); no workspace extends it |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `cdk.out/`, `*.tsbuildinfo`, `.env`, `.env.*`, `frontend/public/config.json`, `coverage/`, plus the AI-DLC block; does not ignore `cdk-outputs.json` |
| `shared/package.json` | Source-only package exporting `./src/index.ts`; no scripts |
| `backend/package.json` | Scripts `typecheck` (`tsc -p tsconfig.json`) and `test` (`vitest run`); AWS SDK v3 clients and zod declared |
| `infra/package.json` | Scripts `synth` (`cdk synth`) and `deploy` (`cdk deploy --require-approval never --outputs-file cdk-outputs.json`); CDK v2 declared |
| `frontend/package.json` | Vite, React 19, Amplify, Vitest with jsdom and Testing Library declared; `build` runs `tsc` then `vite build` |
| `shared/src/types.ts` (style sample), `shared/src/index.ts` | Two-space indentation, single quotes, semicolons, `.js` extension on relative imports, longest line 145 characters, 385 lines |

### Git history and CI/deploy configuration

| Check | Result |
|---|---|
| `git log --all` | One commit: `1eb3610` "first commit", 2026-10-16, author Quangminh27405, README only |
| `git branch -a -vv` | `main` only, tracking `origin/main` |
| `git remote -v` | `origin` = `https://github.com/QuangMinhNguyen27405/jarvel.git` |
| `git tag -l` | No tags |
| `git status` (from the brief) | Everything except README is untracked |
| Search for CI/deploy/lint config at the project level (`.github/`, `.gitlab-ci.yml`, `buildspec*.yml`, `appspec*.yml`, `.circleci/`, `Jenkinsfile`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `.prettierrc*`, `.eslintrc*`, `eslint.config.*`, `biome.json`, `.editorconfig`, `.husky/`, `.nvmrc`, `.node-version`, `cdk.json`, `Dockerfile`, `CODEOWNERS`, `CONTRIBUTING*`) | None found. The only matches were inside `node_modules/` and belong to third-party packages |

### Approved Ideation artifacts and workflow state

| Source | Finding used here |
|---|---|
| `ideation/feasibility/constraint-register.md` | C-02 under 10 hours a week (about 45 hours in total); C-03 total running cost under $25 per month including building and testing; C-07 the builder's existing AWS account; C-10 one builder, no one else to review; C-16 backend API only |
| `ideation/scope-definition/scope-document.md` | Milestones: first working plan for the requester's trip by Nov 1, 2026; all must-haves by Nov 18, 2026 |
| `aidlc-state.md` | Scope `feature`, Depth Standard, Test Strategy Standard, Construction Iteration unit-major, Construction Execution serial |
| `.claude/scopes/aidlc-feature.md` | `skeleton: on` |

### Rule layers

| Source | Use |
|---|---|
| `aidlc/spaces/default/memory/org.md` | Way of Working, Walking Skeleton, Testing Posture, Deployment and Code Style used as **suggested defaults only** |
| `aidlc/spaces/default/memory/team.md` | All sections empty: first run, no affirmed baseline |
| `aidlc/spaces/default/memory/project.md` | No practice sections; the two Corrections were applied (ARCHITECTURE.md as context only; access-control backlog rule is not relevant to this stage) |
| `aidlc/spaces/default/memory/phases/operation.md` | Infrastructure security changes need review; every deployment needs rollback steps and a smoke check |

### `docs/ARCHITECTURE.md`

Used only as context for interview questions, as the project rule requires. Nothing in the practices is taken from it as fact. It mentions unit tests that make no AWS calls and mock the AI model, which shaped the wording of interview question Q4. The builder's answer to Q4 and the cost cap (C-03) are the basis for the rule against paid AWS calls in tests, not the document.

## Findings by Area (lead draft, before the interview)

Tags: **E** = evidenced, **I** = inferred, **D** = org default that needed confirmation. The interview settled every **I** and **D** row (see "Interview Decisions").

| Area | Finding | Tag |
|---|---|---|
| Way of Working | GitHub-hosted, `main` only, one commit, no tags, no PR or branch-protection config visible locally | E |
| Way of Working | Solo builder, no peer reviewer | E (C-10) |
| Way of Working | Trunk-based, short-lived branches, squash-merge to `main` | D |
| Way of Working | A pull request would be a self-review plus CI | I |
| Walking Skeleton | Scope turns the practice on | E |
| Walking Skeleton | Thin slice first, proven by a human-approved verification command | D |
| Walking Skeleton | The slice aligns with the Nov 1 "first working plan" milestone | I |
| Testing Posture | No tests, so no cadence to observe; Vitest declared in three packages; `coverage/` ignored | E |
| Testing Posture | Methodology test-after; implement each layer, then test it | D |
| Testing Posture | 80% line-coverage floor and CI before merge for `feature` scope | D |
| Testing Posture | Paid AWS and AI calls replaced with test doubles in automated tests | I (C-03) |
| Deployment | One existing AWS account; under $25 per month; CDK v2; local deploy script only; no CI/CD | E |
| Deployment | Deploy script skips CDK security approval | E (TD-8) |
| Deployment | Deploy on merge to staging; production behind manual approval | D |
| Deployment | GitHub Actions is the closest fit for a pipeline | I |
| Code Style | No formatter or linter; strict TypeScript base config; observed style in `types.ts` | E |
| Code Style | Formatter and linter at the repo root, run in CI, failure blocks merge | D |
| Code Style | Prettier, if chosen, configured to match the existing style | I |

## Interview Decisions

Source: `aidlc/spaces/default/intents/261017-jarvel-backend-api/inception/practices-discovery/practices-discovery-questions.md`. Every answer was the recommended option, and the builder confirmed the consolidated summary with "Looks correct".

| Question | Answer | Effect on the practices |
|---|---|---|
| Q1. How should changes reach `main`? | A: short-lived branch plus GitHub pull request, squash-merged once CI passes | Way of Working: trunk-based, PR per change, builder self-approves, squash-merge after green CI |
| Q2. Build a thin end-to-end slice first? | A: yes; a request to the API deployed in the builder's AWS account returns a basic plan | Walking Skeleton: deployed end-to-end slice, aimed at the Nov 1, 2026 milestone; a local-only run does not count |
| Q3. When are tests written? | A: after each layer, run before moving on (test-after) | Testing Posture: `Methodology: test-after`; 80% line-coverage floor in CI stays |
| Q4. Should anything run against real AWS? | A: fakes for every paid AWS service and the AI model; only a short smoke check against the real deployment after each deploy | Testing Posture and Deployment: no paid calls from tests; post-deploy smoke check |
| Q5. How many environments? | A: staging plus production, production behind the builder's explicit approval | Deployment: two environments in the one account, matching the org default (no conflict) |
| Q6. Where do deployments run, and how are security changes reviewed? | A: GitHub Actions; the pipeline shows the CDK diff, and security-related changes wait for the builder's approval | Deployment: CI on every PR, staging on merge, production after approval and diff review; `--require-approval never` is replaced |
| Q7. Formatter and linter? | A: Prettier matched to the existing file (single quotes, semicolons, wider print width) plus ESLint with typescript-eslint, both in CI and blocking merges | Code Style: Prettier (print width 120, as recommended in the lead's draft) and typescript-eslint recommended rules |
| Q8. Which hard rules? | A, B, C, D, E | `discovered-rules.md`: three Mandated and two Forbidden rules. Draft candidate F-3 was not offered and is dropped; Mandated rule C covers it |

## Unresolved Uncertainties

The interview settled all eight draft uncertainties. Only details for later stages remain; none of them changes a practice:

1. **Print width.** Q7 option A said "wider print width". The practices record 120, the value recommended in the lead's draft and in the summary the builder confirmed. The ci-pipeline stage sets it in `.prettierrc`.
2. **Smoke check content and rollback mechanics.** The practices require a post-deploy smoke check and written rollback steps. The exact check, and how a rollback is triggered, belong to the deployment-pipeline and deployment-execution stages.
3. **Skeleton verification command.** The slice must prove a deployed request returns a basic plan. The exact command is chosen and approved at the Construction verification-command checkpoint.
4. **Cost of two environments.** Staging and production share one account under the $25-per-month cap. The cost is checked once the architecture is chosen.

## Other Observations (not practices, for later stages)

- The scaffold is untracked: `main` contains only the README. Until the scaffold is committed, any branch or worktree made from `main` would not contain it, and CI would have nothing to run. Committing the current scaffold is a one-time step to settle before Construction.
- The root `deploy` script builds the frontend first, but the traveler web app is out of scope (C-16) and the frontend has no source, so the script would fail as written. The deployment-pipeline stage must change this chain.
- `npm audit` has not been run (`codekb/jarvel/dependencies.md`).
- `@types/node` 26 is newer than the Node 22 floor (TD-10); a CI job should pin Node 22 to catch this.
