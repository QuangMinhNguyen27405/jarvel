# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> Use sparingly: most teams don't need a project layer. Reach for it
> only when this specific project needs stable, durable guidance beyond the
> team practice (for example, package-specific release checks or an additional
> regression suite for a legacy component).

## Way of Working

<!-- Project-specific specialisation. Example: -->
<!-- This monorepo requires package-scoped branch names and a package owner -->
<!-- review in addition to the team's normal merge policy. -->

## Walking Skeleton

<!-- Project-specific specialisation. Example: -->
<!-- The walking skeleton must exercise the legacy service adapter as well -->
<!-- as the new service boundary. -->

## Testing Posture

<!-- Project-specific specialisation. -->

- Test database code against a small in-memory table behind aws-sdk-client-mock that applies the real condition and update expressions, not canned responses per test, so concurrency and status-transition tests check real conditional-write behavior. (learned 2026-10-26) <!-- cid:261017-jarvel-backend-api:code-generation:15343448b62f35287f15d2f942d3151182c18a32590a8439c825eba4feeccd30 -->

## Guard Policy

<!-- Project-specific. Mode: strict, relaxed, or off. Strict here holds for every intent, whatever one person asks in chat; relaxed or off here applies to every intent whose policy came from its scope, unless the person sets another; changing this line changes it. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

<!-- Project-specific specialisation. -->

## Code Style

<!-- Project-specific specialisation. -->

## Tech Stack

<!-- Technology choices locked for this project. -->

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->
<!-- Example: NEVER throw exceptions across service layer boundaries (affirmed 2026-05-17) -->

- NEVER call paid AWS services, including the AI model, from the automated test suite. (affirmed 2026-10-23)

- NEVER commit `.env` files, credentials, or deploy outputs such as `cdk-outputs.json`. (affirmed 2026-10-23)

## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->
<!-- Example: ALWAYS use Result<T,E> for fallible operations in service layer (affirmed 2026-05-17) -->

- ALWAYS run the type check and the full test suite in CI and require both to pass before merging to `main`. (affirmed 2026-10-23)

- ALWAYS import shared types from `@jarvel/shared` and declare it as a dependency in every package that uses it. (affirmed 2026-10-23)

- ALWAYS review the CDK diff of security-related infrastructure changes (IAM, network, encryption) before deploying. (affirmed 2026-10-23)

## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->
- Use docs/ARCHITECTURE.md only as context for questions, never as a source; its design reaches artifacts only through answers the person confirms. (learned 2026-10-17) <!-- cid:261017-jarvel-backend-api:intent-capture:16fe59291a7cf72d6a8e3fefcfcdda106915fbfa04ad9db7b925f0913833d447 -->
- When the scope limits who can use the product (for example invite-only), list that access control as its own must-have backlog item. (learned 2026-10-19) <!-- cid:261017-jarvel-backend-api:scope-definition:b3a4dd73c2446177f7bcf086f5b5682113e8a8b0b63e669b1d42efdac1ace73d -->
