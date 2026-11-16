# Deployment Strategy: Jarvel Backend API

Written on 2026-11-15. Nothing has been deployed yet. This document says how deploys are meant to work once the setup in `cd-config.md` is done.

## Strategy

**All at once, one stage at a time.** Each deploy is one CloudFormation update of one stack (`Jarvel-staging`, then `Jarvel-prod`). Every deploy is the code of exactly one commit on `main`.

- **Why:** the app is an HTTP API with two Lambda functions for fewer than 10 invited people, under a $25 monthly cap. An update takes effect in one step, and CloudFormation undoes a failed update by itself.
- **What it costs:** for the moment of the switch, a request can reach either the old or the new function code. With this few users that is accepted.
- **Not taken:** a gradual (canary) rollout that sends 10% of requests to the new version first. It would add CodeDeploy, Lambda aliases and new IAM permissions to the stack, for a benefit this number of users does not need. Because there is no gradual rollout, there are no traffic-shifting or abort conditions to define.

## Environment Promotion

| Step | What happens | Gate to pass | Who or what decides |
|---|---|---|---|
| 1. Pull request to `main` | The checks run (`ci.yml`) | Every check passes | GitHub, by branch protection |
| 2. Merge to `main` | The deploy workflow starts and runs the checks again | Every check passes | The pipeline |
| 3. Staging diff | The CDK diff for staging is printed | The change does not broaden permissions or network access | The pipeline |
| 4. Staging deploy | `Jarvel-staging` is updated | The update succeeds | CloudFormation |
| 5. Staging smoke check | Health check, and a request with no sign-in is refused | Both pass | The pipeline |
| 6. Production diff | The CDK diff for production is printed | The change does not broaden permissions or network access | The pipeline |
| 7. Production approval | The deploy job waits in the `production` environment | You have read the diff from step 6 and press Approve | You |
| 8. Production deploy | `Jarvel-prod` is updated | The update succeeds | CloudFormation |
| 9. Production smoke check | The same short check | Both parts pass | The pipeline |

A failure at any step stops everything after it. Production is never deployed from a commit that did not pass staging in the same run.

There is no separate development environment. Development happens on the builder's computer with the local server, which costs nothing.

## Production Approval

- The `production` GitHub environment has the builder as its required reviewer.
- Before approving, read the "Show the prod diff" job of the same run, especially any IAM, network access or encryption change. This is the team rule and the project rule on CDK diffs.
- Rejecting, or leaving the run unapproved, deploys nothing to production. Staging keeps the new version.
- The approval covers the diff shown in that run. The deploy job builds the template again from the same commit, so it deploys the same change unless the stack was changed by hand in between.

## Security-Related Changes

The team rule is that we do not deploy with `cdk deploy --require-approval never`. A pipeline runner has nobody at a terminal to answer CDK's question, so the pipeline does not deploy a change that broadens permissions or network access. It stops in the diff job and says so.

For such a change:

1. Read the diff the pipeline printed.
2. Deploy it from your own computer, as `backend/README.md` ("Deploying") describes, and answer CDK's question yourself.
3. Run the workflow again (re-run the failed jobs). The diff is now empty for that stage, so the pipeline carries on.

This applies to the first deploy of each stage, because a new stack creates every role and policy. It applies to staging too, not only production.

If you would rather approve these changes in GitHub and have the pipeline deploy them, the team rule in `aidlc/spaces/default/memory/team.md` ("Deployment") has to change first. Until that line changes, the rule holds.

## Smoke Checks

| Check | When | What it does | Cost |
|---|---|---|---|
| Short check | Automatically, after every deploy of every stage | `GET /health` answers 200 with status ok, and `POST /plans` with no sign-in answers 401 | Nothing |
| Full check | By hand: after the first deploy of a stage, and after any change to the planner, the AI call or sign-in | Sign in as a test account, build a plan, read it as Markdown, delete it (`backend/README.md`, "Post-deploy smoke check") | One AI call and one of the tester's 3 monthly plans |

The full check is not automatic because each run uses up one of the tester's 3 plans for the month, and deleting the plan does not give it back.

## Feature Flags

**None.** Nothing in this version is switched on or off at run time, and a flag service (AppConfig or CloudWatch Evidently) would add cost and moving parts for one builder and fewer than 10 users. A change is turned off by reverting its commit.

This is an assumption of this document. It was not one of the four questions asked.

## Assumptions and Open Points

- **The first deploy of each stage is by hand.** It belongs to the Deployment Execution stage and needs your approval and your AWS credentials.
- **Every merge to `main` deploys to staging**, including a change that only touches documents or the web app. The update is then empty and takes about as long as the checks. Limiting deploys to certain folders is a possible later change.
- **The web app has no deploy path.** The stack does not host it, and this pipeline only builds it as a check.
- **The pipeline has never run.** Times, costs of runner minutes and real behavior on GitHub are not measured. GitHub Actions is free for public repositories.
- **Two budgets.** Each stage creates its own budget alert covering the whole account, so with both stages deployed you get two alert emails at $20.
