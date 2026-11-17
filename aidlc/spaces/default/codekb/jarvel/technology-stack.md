# Technology Stack

Versions are the exact resolved versions in `package-lock.json`, identical to the declared caret ranges. "Used" means at least one source file imports the package; only `shared` has source, and it imports nothing.

## Languages and Runtime

| Item | Version | Source |
|---|---|---|
| TypeScript | 7.0.2 | devDependency in backend, infra, frontend |
| Node.js | >=22 (engines) | root `package.json` |
| Module system | ES modules | `"type": "module"` in every package |
| Compiler target | ES2022, `module: ESNext`, `moduleResolution: Bundler`, `strict`, `noUncheckedIndexedAccess`, `noEmit` | `tsconfig.base.json` |

## Build, Test and Tooling

| Tool | Version | Package | Used |
|---|---|---|---|
| npm workspaces | lockfile v3 | root | Yes (scripts) |
| esbuild | 0.28.2 | backend, infra | No |
| Vite | 8.3.4 | frontend | No |
| @vitejs/plugin-react | 6.1.2 | frontend | No |
| tsx | 4.23.15 | infra | No |
| Vitest | 5.0.5 | backend, infra, frontend | Runs, but finds no tests |
| jsdom | 30.1.3 | frontend | No |
| @testing-library/react / jest-dom | 16.3.3 / 7.0.1 | frontend | No |
| AWS CDK CLI (`aws-cdk`) | 2.1145.0 | infra | No |

## Backend Libraries (declared, unused)

| Library | Version | Purpose |
|---|---|---|
| @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb | 3.1152.0 | DynamoDB access |
| @aws-sdk/client-s3 | 3.1152.0 | S3 access |
| @aws-sdk/client-sfn | 3.1152.0 | Step Functions |
| @aws-sdk/client-bedrock-runtime | 3.1152.0 | Bedrock model calls |
| zod | 4.6.7 | Runtime validation |
| @types/aws-lambda | 8.10.164 | Lambda handler typings |
| @types/node | 26.6.5 | Node typings (newer than the Node 22 floor) |

## Infrastructure Libraries (declared, unused)

| Library | Version |
|---|---|
| aws-cdk-lib | 2.273.0 |
| constructs | 10.8.1 |

## Frontend Libraries (declared, unused)

| Library | Version |
|---|---|
| react, react-dom | 19.3.1 |
| aws-amplify | 6.22.2 |
| @aws-amplify/ui-react | 6.15.7 |
| leaflet / react-leaflet | 1.9.4 / 5.0.0 |
| @types/react, @types/react-dom, @types/leaflet | 19.3.0, 19.3.0, 1.9.22 |

## Cloud Platform

AWS is implied by the dependencies (SDK, CDK, Amplify). No account, region, stack or resource is defined in code. `docs/ARCHITECTURE.md` names us-east-1 and a single `JarvelStack`. Both are **described in the doc but not implemented**. The doc also says "React 18", while the frontend manifest declares React 19.3.1.

## Not Present
- Linter or formatter (ESLint, Prettier)
- CI/CD tooling
- Containerisation (Dockerfile, compose)
- Database migration tooling
