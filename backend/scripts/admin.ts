// Admin actions, run locally under the admin's own AWS credentials (D8, A-5). There is no admin API: only someone
// whose credentials may call these Cognito actions can run them (AC6.1.3).
//
// Usage (from the repository root, with the stack outputs in the environment):
//   USER_POOL_ID=... TABLE_NAME=... AWS_REGION=us-east-1 npm run admin -w @jarvel/backend -- invite person@example.com
//   ... -- disable person@example.com          (disable + sign out everywhere; tokens stop working within 1 hour)
//   ... -- delete-account person@example.com   (Cognito user, every plan and idempotency key; the month's count is kept)
//   ... -- delete-account --sub <sub>          (re-runs the data cleanup for a deleted account by its user id)
//
// delete-account first writes a marker for the user id (no email) that makes the API refuse it, so a token that is
// still valid cannot create anything after the cleanup. The marker expires after DELETED_MARKER_HOURS (2 hours,
// longer than any access token lives).
import { pathToFileURL } from 'node:url';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { z } from 'zod';
import { createDocumentClient, requiredEnv } from '../src/lib/dynamo.js';
import { hashEmail, QuotaStore } from '../src/lib/quota.js';
import { PlanStore } from '../src/lib/store.js';

export interface AdminDeps {
  cognito: Pick<CognitoIdentityProviderClient, 'send'>;
  store: PlanStore;
  quota: QuotaStore;
  userPoolId: string;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
}

export const USAGE = 'Usage: admin <invite|disable|delete-account> <email>  |  admin delete-account --sub <sub>';
const REFUSED = new Set(['AccessDeniedException', 'NotAuthorizedException', 'UnrecognizedClientException']);
const emailSchema = z.email();
/** A Cognito `sub` is a UUID; anything outside this shape could not be one and could break the table keys. */
const SUB_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

function errorName(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? 'Error';
}

async function subOf(deps: AdminDeps, email: string): Promise<string> {
  const user = await deps.cognito.send(new AdminGetUserCommand({ UserPoolId: deps.userPoolId, Username: email }));
  const sub = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  if (!sub) throw new Error('The user has no sub attribute');
  return sub;
}

async function signOutEverywhere(deps: AdminDeps, email: string): Promise<void> {
  await deps.cognito.send(new AdminDisableUserCommand({ UserPoolId: deps.userPoolId, Username: email }));
  await deps.cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: deps.userPoolId, Username: email }));
}

async function invite(deps: AdminDeps, email: string): Promise<number> {
  try {
    const created = await deps.cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: deps.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    const sub = created.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value;
    deps.out(`Invited ${email}. Cognito has emailed them a temporary password.`);
    if (sub) {
      const carried = await deps.quota.restoreHeld(sub, hashEmail(email), deps.now());
      if (carried > 0)
        deps.out(`Carried over ${carried} plan(s) already counted this month from their deleted account.`);
    }
    return 0;
  } catch (error) {
    if (errorName(error) === 'UsernameExistsException') {
      deps.err(`${email} is already invited. No second account was created.`);
      return 1;
    }
    throw error;
  }
}

async function disable(deps: AdminDeps, email: string): Promise<number> {
  await signOutEverywhere(deps, email);
  deps.out(`Disabled ${email} and signed them out everywhere. Their access tokens stop working within 1 hour.`);
  return 0;
}

async function deleteAccount(deps: AdminDeps, email: string): Promise<number> {
  const sub = await subOf(deps, email);
  await deps.store.markAccountDeleted(sub);
  await signOutEverywhere(deps, email);
  const removed = await deps.store.deleteAllForUser(sub);
  const held = await deps.quota.holdForDeletedAccount(sub, hashEmail(email), deps.now());
  await deps.cognito.send(new AdminDeleteUserCommand({ UserPoolId: deps.userPoolId, Username: email }));
  deps.out(
    `Deleted ${email}: the sign-in identity, ${removed.plans} plan(s) and ${removed.idempotencyKeys} retry key(s). ` +
      `${held} plan(s) counted this month stay counted if they are invited again. ` +
      `User id: ${sub} (to re-run the cleanup later: delete-account --sub ${sub}).`,
  );
  return 0;
}

/**
 * Re-runs the data cleanup of a deleted account by its user id, when the email (and so the Cognito user) is
 * already gone. It removes items written after the first cleanup, for example by a request that was in flight.
 * Leftover quota items are removed too; with no email there is no hold to add them to.
 */
async function deleteAccountBySub(deps: AdminDeps, sub: string): Promise<number> {
  await deps.store.markAccountDeleted(sub);
  const removed = await deps.store.deleteAllForUser(sub);
  const quotaItems = await deps.quota.removeForDeletedAccount(sub);
  deps.out(
    `Cleaned up user id ${sub}: ${removed.plans} plan(s), ${removed.idempotencyKeys} retry key(s) and ` +
      `${quotaItems} monthly count item(s). The API refuses this user id. ` +
      'If their sign-in identity still exists, also run delete-account with their email.',
  );
  return 0;
}

async function runDeleteBySub(rawSub: string | undefined, deps: AdminDeps): Promise<number> {
  const sub = rawSub?.trim() ?? '';
  if (!SUB_PATTERN.test(sub)) {
    deps.err(rawSub === undefined ? USAGE : `"${rawSub}" is not a valid user id (sub).`);
    return 2;
  }
  try {
    return await deleteAccountBySub(deps, sub);
  } catch (error) {
    deps.err(failureMessage('delete-account --sub', sub, error));
    return 1;
  }
}

function failureMessage(command: string, target: string, error: unknown): string {
  const name = errorName(error);
  if (REFUSED.has(name)) return `Refused: your AWS credentials are not allowed to run admin actions (${name}).`;
  if (name === 'UserNotFoundException') return `${target} is not an invited user.`;
  return `${command} failed: ${name}: ${(error as Error).message}`;
}

/** Runs one admin command and returns the process exit code (0 ok, 1 refused or failed, 2 usage). */
export async function runAdmin(argv: string[], deps: AdminDeps): Promise<number> {
  const [command, rawEmail] = argv;
  if (command === 'delete-account' && rawEmail === '--sub') return runDeleteBySub(argv[2], deps);
  const email = rawEmail?.trim().toLowerCase() ?? '';
  if (!command || !['invite', 'disable', 'delete-account'].includes(command) || !rawEmail) {
    deps.err(USAGE);
    return 2;
  }
  if (!emailSchema.safeParse(email).success) {
    deps.err(`"${rawEmail}" is not a valid email address.`);
    return 2;
  }
  try {
    if (command === 'invite') return await invite(deps, email);
    if (command === 'disable') return await disable(deps, email);
    return await deleteAccount(deps, email);
  } catch (error) {
    deps.err(failureMessage(command, email, error));
    return 1;
  }
}

function defaultDeps(): AdminDeps {
  const tableName = requiredEnv('TABLE_NAME');
  const doc = createDocumentClient();
  return {
    cognito: new CognitoIdentityProviderClient({ region: process.env.AWS_REGION }),
    store: new PlanStore(doc, tableName),
    quota: new QuotaStore(doc, tableName),
    userPoolId: requiredEnv('USER_POOL_ID'),
    now: () => new Date(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  Promise.resolve()
    .then(() => runAdmin(process.argv.slice(2), defaultDeps()))
    .then(
      (code) => {
        process.exitCode = code;
      },
      (error: unknown) => {
        console.error(`admin failed: ${(error as Error).message}`);
        process.exitCode = 1;
      },
    );
}
