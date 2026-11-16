# Deployment Execution Questions

This stage is the first real deploy to AWS. It creates resources in your account, can cost money and sends emails, so nothing is deployed until you say so.

Pre-deployment checks, first made on 2026-11-15 and made again on 2026-11-16:

| Check | Result |
|---|---|
| Build and tests | Pass locally on 2026-11-16, on the code as it is on this computer (including the uncommitted web app changes): type check, lint, format check and data check exit with code 0; `npm test` passes 401 tests (backend 303, infra 15, web app 83); line coverage is 96.38% in `backend` and 98.3% in `infra`. The earlier run is in `construction/build-and-test/test-results.md` (363 tests). The checks have not run on GitHub yet. |
| Database migrations | None needed. The stack creates the one table; there is no existing data. |
| AWS sign-in on this computer | **Expired**, still on 2026-11-16. `aws sts get-caller-identity` answers "Your session has expired. Please reauthenticate using 'aws login'." |
| Account prepared for CDK (`cdk bootstrap`) | Unknown. It cannot be checked until you sign in. |
| An existing `Jarvel-staging` or `Jarvel-prod` stack | Unknown, for the same reason. |
| Access to the AI model in Amazon Bedrock | Unknown. The first real plan will show it. |
| Deployment window | No limit. Nobody uses the API yet. |

Two things are fixed and are not asked:

- **You run the deploy command yourself, in your own terminal.** A new stack creates roles and policies, CDK asks you to confirm them, and your team rule is that this question is never skipped. I prepare the commands and the diff, and I run the smoke check afterwards.
- **You choose the alert address and the test account's address** when you run the commands. I do not need to see either.

## Q1. Where should the first deploy come from?
Your team rule is that every change reaches `main` through a pull request with passing checks, and a deploy is the code of one commit. Today this work is on the branch `feature/backend-api-web-app-demo`, with uncommitted changes, and it is not pushed.

A. Get it onto `main` first: commit, push, open a pull request, let the checks run on GitHub for the first time, merge, then deploy staging from `main` (recommended)
B. Deploy staging now from this branch as it is on this computer, and do the pull request afterwards
C. Do not deploy now. Stop here and carry on another time
X. Other (please specify)

[Answer]: A

## Q2. Your email address is in two committed files. What should happen before anything is pushed?
The repository on GitHub is public. `backend/scripts/demo.ts` has your address as the demo account's default, and the code plan quotes it. Both are in the two local commits that are not pushed yet.

A. Replace it with a placeholder (`demo@example.com`) in both files, and push the work as one new commit on a new branch, so the address is not in anything that reaches GitHub. You set `DEMO_EMAIL` on your computer to use your own address (recommended)
B. Leave it. It is fine for the address to be public
C. Nothing is being pushed now, so decide later
X. Other (please specify)

[Answer]: A

## Q3. How far should this first deploy go?

A. Staging only. Run the full smoke check there, and deploy production later (recommended)
B. Staging, then production in the same session once staging passes the full smoke check
X. Other (please specify)

[Answer]: A

## Q4. How do you want to use it once it is deployed?
Added on 2026-11-16, because you said you want to deploy this and use it. The deploy puts the API, the sign-in and the plans table on AWS. It does not put the web app on the internet: the stack does not host it (`operation/deployment-pipeline/cd-config.md`, "Not Verified"). The web app can already run on this computer against a deployed API, through a `frontend/public/config.json` file that git ignores.

A. Run the web app on this computer, connected to the deployed API. After the deploy I write `frontend/public/config.json` from the stack outputs and invite an account for you with the admin script; you sign in at `http://localhost:5173` (recommended: it needs no new code)
B. The same as A now, and afterwards put the web app on the internet with its own address. That is new work that is not built yet (hosting added to the stack), so it would be its own piece of work after this deploy
C. Only the API, from a terminal. No web app
X. Other (please specify)

[Answer]: A

## Q5. Your commits carry the same email address. Which address should new commits show?
A follow-up to Q2, found on 2026-11-16 while preparing the push. The address removed from the two files is also the author address git puts on every commit made on this computer. It is already public on GitHub, as the author of the first commit on `main`. A new commit would show it again.

A. Use GitHub's private no-reply address for commits in this repository from now on. New commits no longer show your address. The first commit on GitHub still does (recommended)
B. Keep your address on commits. It is already public there
C. Use the private address, and also replace the first commit on GitHub's `main` so the address leaves the repository's history. This overwrites `main` on GitHub (it holds only that one commit); copies GitHub or anyone else already made can still show the old commit
X. Other (please specify)

[Answer]: A

## Q6. The workflow's log file would become public too. Should it be pushed?
Found on 2026-11-16 in the same check. `aidlc/spaces/default/intents/261017-jarvel-backend-api/audit/` holds one log file. It contains no keys, passwords or email addresses. It does contain your Windows user folder name (in 34 temporary-file paths), this computer's name (in the file name) and the choices and requests recorded in this workflow. It is already in your local commits, and the project's own rule is to commit the `aidlc/` folder.

A. Push the records as they are, log included (recommended: it follows the project's rule, and nothing in it is a secret)
B. Leave the log file out of what is pushed. It stays on this computer only
C. Leave the whole `aidlc/` records folder out of what is pushed. Only the code, the workflows and the documents go to GitHub
X. Other (please specify)

[Answer]: A
