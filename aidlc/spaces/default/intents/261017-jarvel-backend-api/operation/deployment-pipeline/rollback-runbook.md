# Rollback Runbook: Jarvel Backend API

Written on 2026-11-15. These steps have **not been practiced**: nothing is deployed yet. Try the "Roll Back by Hand" steps once on staging after the first deploy.

A rollback here means deploying the last commit that worked. Every deploy is the code of one commit, so going back is deploying an older commit again.

## When to Roll Back

Roll back the stage when any of these is true after a deploy:

- The pipeline's smoke check failed (the run shows "Smoke check failed").
- The full smoke check by hand failed: sign-in, building a plan, reading it or deleting it.
- The "API 5xx" alarm or the "PlansFailed" alarm emailed you soon after the deploy, and the cause is the new version.
- Invited people report that plans fail or the API refuses them, and the cause is the new version.

Do not roll back for a problem in the Boston data alone. Fix the data, run `npm run validate:data`, and deploy forward.

## What Undoes Itself

- **A CloudFormation update that fails part-way** rolls the stack back to its previous state by itself. The pipeline run fails, and nothing more is needed for that stage. Read the error in the run, fix the cause and merge again.
- **A failed staging deploy or staging smoke check** stops the pipeline before production. Production still runs the previous version.

## Roll Back by Hand

Use this when production is broken and you want it fixed first. It takes the previous good commit and deploys it from your own computer.

```bash
git fetch origin
git checkout <previous-good-commit>
npm ci
npm run validate:data
npm run diff -w @jarvel/infra -- -c stage=prod -c alertEmail=<your alert address>
npm run deploy -w @jarvel/infra -- -c stage=prod -c alertEmail=<your alert address>
```

1. Find `<previous-good-commit>`: it is the commit of the last deploy run that finished green on GitHub (Actions, "Deploy" workflow).
2. Read the diff before you deploy. A rollback is a change too, and it can widen permissions if the bad commit had narrowed them. CDK asks you to confirm such a change; do not skip that with `--require-approval never`.
3. Use `stage=staging` in both commands to roll back staging.
4. Run the smoke check ("Check That It Worked").
5. Then make `main` match what is deployed, with "Revert on `main`". Otherwise the next merge deploys the bad change again.

`infra/cdk-outputs.json` is written by the deploy. Never commit it.

## Revert on `main`

This is the normal way back when production is not broken, or the follow-up after a rollback by hand.

1. Create a branch from `main` and revert the bad commit: `git revert <bad-commit>`.
2. Open a pull request. The checks run.
3. Merge it. The pipeline deploys staging and runs the smoke check.
4. Read the production diff and approve the production deploy.

If the revert broadens permissions or network access, the pipeline stops and says so. Deploy that stage by hand as above, then re-run the failed jobs.

## A Faster Way Through the Pipeline

On GitHub, open the last green run of the "Deploy" workflow and choose "Re-run all jobs". It deploys that run's commit again, staging first, then production after your approval. GitHub allows a re-run for 30 days after the original run. Follow it with "Revert on `main`", for the same reason as above.

## What a Rollback Does Not Touch

- **Plans and accounts are kept.** The plans table and the user pool are set to `RETAIN`, so no rollback, failed update or stack deletion removes them. A rollback changes code and configuration only.
- **Data written by the bad version stays.** If the bad version wrote wrong plans, rolling back the code does not correct them. People can delete their own plans. The table has point-in-time recovery, which can restore it to a new table as it was at a chosen minute in the last 35 days; that is a manual AWS step and has not been tried.
- **Monthly counts stay.** A plan that failed gives its count back by itself. Nothing else resets a count.

## Check That It Worked

```bash
API=<ApiUrl of the stage, without the trailing slash>
curl -s "$API/health"                                         # expect {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/plans"  # expect 401
```

Then run the full smoke check in `backend/README.md` ("Post-deploy smoke check") if the problem was in sign-in, the planner or the AI call. Watch for alarm emails for the next hour.

## Who to Contact

- **The builder is the only operator.** Alarm and budget emails go to the stack's alert address.
- **There is no second person to escalate to** and no on-call rota. If the builder cannot fix or roll back, the fallback is to stop new plans by disabling the invited accounts (`npm run admin -w @jarvel/backend -- disable <email>`), which costs nothing and loses no data.
- **AWS problems** (an outage in `us-east-1`, an account issue): check the AWS Health Dashboard. No AWS Support plan is recorded for this account.

## After a Rollback

Write down what happened while it is fresh: when the bad deploy went out, how it was noticed, what was rolled back and when, the cause, and what would have caught it earlier. A short note in the pull request that reverts the change is enough.
