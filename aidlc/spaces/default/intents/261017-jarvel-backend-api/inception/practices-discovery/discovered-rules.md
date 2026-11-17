# Discovered Rules

## Mandated

- ALWAYS run the type check and the full test suite in CI and require both to pass before merging to `main`.
- ALWAYS import shared types from `@jarvel/shared` and declare it as a dependency in every package that uses it.
- ALWAYS review the CDK diff of security-related infrastructure changes (IAM, network, encryption) before deploying.

## Forbidden

- NEVER call paid AWS services, including the AI model, from the automated test suite.
- NEVER commit `.env` files, credentials, or deploy outputs such as `cdk-outputs.json`.
