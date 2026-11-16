# Deployment Pipeline Questions

These questions settle how a new version reaches staging and production. Some things are already decided and are not asked again:

- GitHub Actions runs the pipeline, and it shows the infrastructure (CDK) diff (practices-discovery Q6).
- There are two environments, staging and production. Every merge to `main` deploys to staging, and production waits for your explicit approval (practices-discovery Q5).
- A short smoke check runs against the real deployment after each deploy (practices-discovery Q4), and a failed one means rolling back to the previous version (team Deployment practice).

What was found in the repository on 2026-11-15: there is no `.github/` folder, so no workflow exists yet. The repository on GitHub is public. Only `main` has been pushed.

## Q1. How should the GitHub pipeline sign in to your AWS account?
The pipeline needs AWS permissions to deploy the stack. The repository is public, so how those permissions are held matters.

A. GitHub's short-lived sign-in (OIDC) with a deploy role. No AWS key is stored in GitHub. It needs a one-time setup in your AWS account: an identity provider and a role that only this repository's `main` branch can use (recommended)
B. An IAM user's access key stored as GitHub secrets. Quicker to set up, but it is a long-lived key that has to be rotated and works from anywhere if it leaks
X. Other (please specify)

[Answer]: A

## Q2. How should a new version be rolled out to a stage?
The app is an HTTP API with two Lambda functions, for fewer than 10 invited people, under a $25 monthly cap.

A. All at once. One CloudFormation update per stage. A failed update rolls itself back. Then the smoke check runs, and if it fails the previous commit is deployed again (recommended)
B. Gradually (canary). 10% of requests go to the new Lambda version for a few minutes while the alarms are watched, then the rest follow, with an automatic rollback on an alarm. This adds CodeDeploy, Lambda aliases and new IAM permissions to the stack
X. Other (please specify)

[Answer]: A

## Q3. How should you approve a production deploy?
Your team rule says production deploys only after you approve it and have read the CDK diff. The repository is public, so GitHub's required-reviewer protection costs nothing.

A. A protected GitHub environment named `production` with you as the required reviewer. After staging passes its smoke check, the pipeline shows the production CDK diff and waits until you press Approve (recommended)
B. A separate workflow that you start by hand ("Run workflow"). It shows the diff and deploys only when you start it and type a confirmation
X. Other (please specify)

[Answer]: A

## Q4. What should this stage produce besides its documents?
The express plan type has no separate CI stage, and your team rule is that the type check, lint, format check and tests run on every pull request. Today no workflow file exists.

A. The documents and the workflow files in `.github/workflows/`: the checks on every pull request, a deploy to staging on every merge to `main`, and production after your approval. Nothing runs until the branch is pushed and the AWS sign-in is set up (recommended)
B. The documents and only the pull-request checks workflow. No deploy workflow yet
C. The documents only. No workflow files for now
X. Other (please specify)

[Answer]: A
