# Deployment Pipeline Configuration: Jarvel Backend API

Written on 2026-11-15. The workflow files below exist in the repository but **have never run**: the branch is not pushed, and the one-time setup in "One-Time Setup" is not done. Nothing was deployed and no GitHub or AWS setting was changed.

## What Was Found

- **No pipeline existed.** There was no `.github/` folder. The CI Pipeline and Infrastructure Design stages were skipped, so there are no earlier CI or infrastructure design files to build on.
- **The infrastructure is one CDK stack per stage** (`infra/lib/jarvel-stack.ts`): `Jarvel-staging` and `Jarvel-prod`, both in `us-east-1`, in one AWS account. `alertEmail` is required to build it.
- **The deploy commands already exist** (`infra/package.json`): `cdk diff` and `cdk deploy --outputs-file cdk-outputs.json`.
- **The repository on GitHub is public** and only `main` has been pushed. Workflow logs of a public repository are public.

## Decisions

| Decision | Choice | Source |
|---|---|---|
| Where the pipeline runs | GitHub Actions | practices-discovery Q6 |
| Environments | staging on every merge to `main`, then production after your approval | practices-discovery Q5 |
| How the pipeline signs in to AWS | GitHub's short-lived sign-in (OIDC) with a deploy role. No AWS key is stored in GitHub | deployment-pipeline Q1 |
| How a version is rolled out | All at once: one CloudFormation update per stage | deployment-pipeline Q2 |
| How production is approved | A protected GitHub environment named `production`, with you as required reviewer | deployment-pipeline Q3 |
| What this stage wrote | These documents and three workflow files | deployment-pipeline Q4 |
| Security-related changes | The pipeline never passes `--require-approval never`. It stops, and you deploy such a change by hand | team Deployment practice |

## Workflow Files

| File | Runs when | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | Every pull request to `main`, and at the start of every deploy | Type check, lint, format check, data check, tests with coverage, web app build, and a local build of the infrastructure template. Uses no AWS credentials and no secrets. |
| `.github/workflows/deploy.yml` | Every push to `main` (a merged pull request) | Runs the checks, then staging, then production. Only one deploy runs at a time; a newer one waits. |
| `.github/workflows/deploy-stage.yml` | Called by `deploy.yml`, once per stage | A `diff` job, then a `deploy` job. |

What the two jobs of `deploy-stage.yml` do:

1. **`diff`** signs in to AWS, prints the CDK diff for the stage, then runs `cdk diff --security-only --fail-on broadening`. If the change adds permissions or opens network access, the job fails with the message "Deploy this change by hand" and nothing is deployed.
2. **`deploy`** runs in the stage's GitHub environment. For `production` it waits there until you approve. Then it checks the Boston data, signs in, runs `cdk deploy --require-approval broadening`, and runs the smoke check.

The security check was tried locally on 2026-11-15 with `cdk diff --template`, without AWS: it exits with code 1 for a brand-new stack and with code 0 for an unchanged stack.

## Quality Gates

| Gate | Where | Blocks |
|---|---|---|
| Type check, lint, format check, data check | `ci.yml` | The merge, and every deploy |
| All tests pass, and line coverage in `backend` and `infra` is at least 80% | `ci.yml` (`npm test`) | The merge, and every deploy |
| The web app and the infrastructure template build | `ci.yml` | The merge, and every deploy |
| No change that broadens permissions or network access | `deploy-stage.yml`, `diff` job | The deploy of that stage and of every later stage |
| Staging deploy and smoke check passed | `deploy.yml` (`production` needs `staging`) | Production |
| Your approval | The `production` environment | The production deploy |
| Smoke check after the deploy | `deploy-stage.yml`, `deploy` job | Marks the run as failed. See `rollback-runbook.md` |

The 80% coverage threshold lives in `backend/vitest.config.ts` and `infra/vitest.config.ts`. It is never lowered to make a run pass.

## One-Time Setup

You do these once, with your own AWS and GitHub access. None of them has been done. Replace `<ACCOUNT_ID>` with your AWS account number.

1. **Prepare the account for CDK**, if it is not already (this creates the roles and the bucket CDK deploys through):

   ```bash
   cd infra
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```

2. **Let AWS trust GitHub's sign-in**, if the account has no such identity provider yet:

   ```bash
   aws iam create-open-id-connect-provider \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com
   ```

3. **Create the deploy role** with this trust policy. It lets only this repository use the role, and only from `main` or from the two environments. A pull request, a fork or another repository cannot use it.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": [
               "repo:QuangMinhNguyen27405/jarvel:ref:refs/heads/main",
               "repo:QuangMinhNguyen27405/jarvel:environment:staging",
               "repo:QuangMinhNguyen27405/jarvel:environment:production"
             ]
           }
         }
       }
     ]
   }
   ```

4. **Give the role one permission:** to use the roles CDK created in step 1. It needs nothing else.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "UseCdkBootstrapRoles",
         "Effect": "Allow",
         "Action": "sts:AssumeRole",
         "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-*-role-<ACCOUNT_ID>-us-east-1"
       }
     ]
   }
   ```

5. **In the GitHub repository settings:**
   - Add two repository secrets: `AWS_DEPLOY_ROLE_ARN` (the role from step 3) and `ALERT_EMAIL` (where alarm and budget emails go). They are secrets so that GitHub hides them in the public logs.
   - Create the environment `staging` with no protection.
   - Create the environment `production` with yourself as the required reviewer, and allow deployments to it from `main` only.
   - Protect `main`: require a pull request, and require the check named "Type check, lint, format, data, tests, build" to pass before merging.

6. **Deploy each stage by hand the first time** (the Deployment Execution stage). The first deploy creates every role and policy, so the pipeline stops on it by design.

## Security Implications and Risk Assessment

This stage adds IAM resources that are created by hand, outside the CDK stack: one identity provider and one role.

| Change | Risk | What limits it |
|---|---|---|
| A role that GitHub can use to deploy | Anyone who could use the role can deploy through CloudFormation. With CDK's default setup, the role CloudFormation deploys with has administrator access. | The trust policy names this repository and only `main` and the two environments. Pull requests and forks get a different identity and are refused. No AWS key exists to leak. |
| Deploys start from `main` without a person at a terminal | A harmful change merged to `main` would reach staging by itself. | Only you can merge. The pipeline stops on any change that broadens permissions or network access. Production also needs your approval. |
| The repository is public, so the logs are public | The logs show the CDK diff (the shape of roles and policies, resource names) and the stack outputs (API address, user pool id, client id, table name). | The alert address and the role are secrets, which GitHub hides. The account id is masked. The API refuses every request without a sign-in, and sign-up is off. |
| Changes to the workflow files themselves | A change to a workflow can change what the pipeline does with the role. | Workflow files change only through a pull request you merge. `pull_request_target` is not used, so a fork's code never runs with the role or the secrets. |

Ways to lower the risk further, not done here:

- Run `cdk bootstrap` with `--cloudformation-execution-policies` naming a narrower policy than administrator access.
- Make the repository private. The required-reviewer protection on `production` then needs a paid GitHub plan, so production approval would change to a manually started workflow (deployment-pipeline Q3, option B).
- Pin each action to a commit, not a version tag (`actions/checkout@v7`, `actions/setup-node@v7`, `aws-actions/configure-aws-credentials@v6`).

## Not Verified

- **No workflow has run.** The files parse as YAML and pass the format check, and the commands in `ci.yml` pass on this Windows computer. They have not run on GitHub's Linux runners.
- **The sign-in to AWS has not been tried.** The trust policy and the role are written here from the documentation of the action and of CDK, and nothing was created in AWS.
- **The automatic smoke check is the short one**: the health check and a refused request with no sign-in. The full check in `backend/README.md` builds a real plan, which uses one of the tester's 3 monthly plans and one AI call, so running it on every merge would use up the tester's month after three merges. It stays a manual step.
- **The web app is not deployed by this pipeline.** The stack does not host it.
