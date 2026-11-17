# Practices Discovery Questions

The repository has almost no history yet (one commit, no CI, no tests, no lint setup), so these questions settle how we will work. Suggested answers come from the evidence in `evidence.md` and the organisation defaults.

## Q1. How should changes reach `main`?
You are the only builder, so a pull request is mainly a place to read the diff and see CI pass, not a second reviewer.

A. Short-lived branch + GitHub pull request, squash-merged once CI passes (recommended)
B. Short-lived branch merged locally into `main`, no pull request
C. Commit straight to `main`
X. Other (please specify)

[Answer]: A

## Q2. Build a thin end-to-end slice first? A walking skeleton is a minimal version that runs the whole way through, built first to prove the pieces connect before the real features go in. If yes, what must it prove?

A. Yes: a request to the deployed API in your AWS account returns a basic plan (recommended; lines up with the Nov 1 milestone)
B. Yes: the same flow, but only running on your machine, nothing deployed
C. No thin slice; build the features one by one
X. Other (please specify)

[Answer]: A

## Q3. When are tests written?

A. After each layer is implemented, then run before moving on (test-after; organisation default) (recommended)
B. Test first for every change (TDD)
C. Mixed: behaviour scenarios written first, unit tests after implementation
X. Other (please specify)

[Answer]: A

## Q4. Should anything run against real AWS (and cost money)?
Running cost must stay under $25 per month, including testing.

A. Automated tests use fakes for every paid AWS service and the AI model; only a short smoke check runs against the real deployment after each deploy (recommended)
B. Fakes only; no automated check against real AWS at all
C. Run some integration tests against real AWS on every merge
X. Other (please specify)

[Answer]: A

## Q5. How many environments?
The organisation default is staging (deployed on every merge) plus production (behind a manual approval). With one account, one builder and the cost cap, a single environment is simpler, but it differs from that default and may be refused as a conflict when the practices are saved.

A. Staging + production, production behind your own explicit approval (organisation default) (recommended)
B. One environment only
X. Other (please specify)

[Answer]: A

## Q6. Where do deployments run, and how are security-related infrastructure changes reviewed?
Today's deploy script runs `cdk deploy --require-approval never`, which skips the prompt for IAM and network changes.

A. GitHub Actions; the pipeline shows the CDK diff and security-related changes wait for your approval (recommended)
B. AWS CodePipeline, with a manual approval step for security-related changes
C. From your own machine with `npm run deploy`, with the CDK approval prompt turned back on
X. Other (please specify)

[Answer]: A

## Q7. Formatter and linter?

A. Prettier (single quotes, semicolons, wider print width to match the existing file) + ESLint with typescript-eslint, both run in CI and blocking merges (recommended)
B. Biome for both formatting and linting, run in CI and blocking merges
C. No formatter or linter for now
X. Other (please specify)

[Answer]: A

## Q8. Which of these should be hard rules? (select all that apply)

A. ALWAYS run the type check and the full test suite in CI and require both to pass before merging to `main`
B. ALWAYS import shared types from `@jarvel/shared` and declare it as a dependency in every package that uses it
C. ALWAYS review the CDK diff of security-related infrastructure changes (IAM, network, encryption) before deploying
D. NEVER call paid AWS services, including the AI model, from the automated test suite
E. NEVER commit `.env` files, credentials, or deploy outputs such as `cdk-outputs.json`
X. Other (please specify)

[Answer]: A, B, C, D, E

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
