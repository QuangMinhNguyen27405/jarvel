import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdmin, USAGE, type AdminDeps } from '../scripts/admin.js';
import { QuotaStore } from '../src/lib/quota.js';
import { DELETED_MARKER_HOURS, PlanStore } from '../src/lib/store.js';
import { createFakeTable, TABLE_NAME, type FakeTable } from './fixtures/fake-dynamo.js';
import { ALICE, BOB, queuedPlan } from './fixtures/plans.js';

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const NOW = new Date('2026-10-23T16:00:00Z');
const EMAIL = 'alice@example.com';
let table: FakeTable;
let out: string[];
let err: string[];
let deps: AdminDeps;

const named = (name: string) => Object.assign(new Error(`${name} from the fake`), { name });

beforeEach(() => {
  cognitoMock.reset();
  table = createFakeTable();
  out = [];
  err = [];
  deps = {
    cognito: new CognitoIdentityProviderClient({ region: 'us-east-1' }),
    store: new PlanStore(table.doc, TABLE_NAME, () => NOW),
    quota: new QuotaStore(table.doc, TABLE_NAME),
    userPoolId: 'us-east-1_testpool',
    now: () => NOW,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  cognitoMock.on(AdminGetUserCommand).resolves({ Username: ALICE, UserAttributes: [{ Name: 'sub', Value: ALICE }] });
});
afterEach(() => table.mock.restore());

describe('admin invite (US6.1)', () => {
  it('creates the user with email delivery of a temporary password (AC6.1.1)', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({ User: { Attributes: [{ Name: 'sub', Value: 'sub-new' }] } });
    expect(await runAdmin(['invite', ' Alice@Example.com '], deps)).toBe(0);
    const input = cognitoMock.commandCalls(AdminCreateUserCommand)[0]!.args[0].input;
    expect(input).toMatchObject({
      UserPoolId: 'us-east-1_testpool',
      Username: EMAIL,
      DesiredDeliveryMediums: ['EMAIL'],
    });
    expect(out[0]).toContain('temporary password');
  });

  it('creates no second account for an address already invited (AC6.1.2)', async () => {
    cognitoMock.on(AdminCreateUserCommand).rejects(named('UsernameExistsException'));
    expect(await runAdmin(['invite', EMAIL], deps)).toBe(1);
    expect(err[0]).toContain('already invited');
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(1);
  });

  it('is refused for credentials that may not run admin actions (AC6.1.3)', async () => {
    cognitoMock.on(AdminCreateUserCommand).rejects(named('AccessDeniedException'));
    expect(await runAdmin(['invite', EMAIL], deps)).toBe(1);
    expect(err[0]).toMatch(/^Refused: your AWS credentials are not allowed/);
  });

  it('refuses a bad command or address with the usage line', async () => {
    expect(await runAdmin([], deps)).toBe(2);
    expect(await runAdmin(['promote', EMAIL], deps)).toBe(2);
    expect(await runAdmin(['invite', 'not-an-email'], deps)).toBe(2);
    expect(err[0]).toBe(USAGE);
    expect(cognitoMock.calls()).toHaveLength(0);
  });
});

describe('admin disable (US6.2)', () => {
  it('disables the user and signs them out everywhere (AC6.2.1, AC6.2.2)', async () => {
    cognitoMock.on(AdminDisableUserCommand).resolves({});
    cognitoMock.on(AdminUserGlobalSignOutCommand).resolves({});
    expect(await runAdmin(['disable', EMAIL], deps)).toBe(0);
    expect(cognitoMock.commandCalls(AdminDisableUserCommand)[0]!.args[0].input.Username).toBe(EMAIL);
    expect(cognitoMock.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
    expect(out[0]).toContain('within 1 hour');
  });

  it('reports an address that was never invited', async () => {
    cognitoMock.on(AdminDisableUserCommand).rejects(named('UserNotFoundException'));
    expect(await runAdmin(['disable', EMAIL], deps)).toBe(1);
    expect(err[0]).toContain('not an invited user');
  });
});

describe('admin delete-account (US6.3)', () => {
  beforeEach(() => {
    cognitoMock.on(AdminDisableUserCommand).resolves({});
    cognitoMock.on(AdminUserGlobalSignOutCommand).resolves({});
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
  });

  it('removes the sign-in identity, every plan and key; only the expiring deleted marker names the user id (AC6.3.1, AC6.3.2)', async () => {
    await deps.store.createPlan(queuedPlan());
    await deps.store.createPlan(queuedPlan());
    table.put({ pk: `USER#${ALICE}`, sk: 'IDEM#k1', planId: 'x' });
    await deps.quota.reserve(ALICE, NOW);
    expect(await runAdmin(['delete-account', EMAIL], deps)).toBe(0);
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
    expect(table.itemsMentioning(ALICE)).toEqual([
      {
        pk: `USER#${ALICE}`,
        sk: 'DELETED',
        entity: 'deleted-account',
        deletedAt: NOW.toISOString(),
        expiresAt: NOW.getTime() / 1000 + DELETED_MARKER_HOURS * 3600,
      },
    ]);
    // R-07: the marker outlives the longest access token (1 hour) but not by days.
    expect(DELETED_MARKER_HOURS * 3600).toBeGreaterThan(3600);
    expect(DELETED_MARKER_HOURS).toBeLessThanOrEqual(6);
    expect(table.itemsMentioning(EMAIL)).toEqual([]);
    expect(out[0]).toContain('2 plan(s)');
    // The email and its Cognito user are gone, so the output is the only place the admin can get the user id for
    // a later `delete-account --sub` re-run.
    expect(out[0]).toContain(`delete-account --sub ${ALICE}`);
  });

  it('keeps the month’s count for a re-invite of the same address (D6)', async () => {
    await deps.quota.reserve(ALICE, NOW);
    await deps.quota.reserve(ALICE, NOW);
    await runAdmin(['delete-account', EMAIL], deps);
    cognitoMock
      .on(AdminCreateUserCommand)
      .resolves({ User: { Attributes: [{ Name: 'sub', Value: 'sub-reinvited' }] } });
    expect(await runAdmin(['invite', EMAIL], deps)).toBe(0);
    expect(await deps.quota.used('sub-reinvited', '2026-10')).toBe(2);
    expect(out.at(-1)).toContain('Carried over 2');
  });

  it('keeps the Cognito user if deleting the data fails, so the command can be run again', async () => {
    await deps.store.createPlan(queuedPlan());
    table.failNext('BatchWrite', new Error('InternalServerError'));
    expect(await runAdmin(['delete-account', EMAIL], deps)).toBe(1);
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(err[0]).toContain('delete-account failed');
  });

  it('marks the user id deleted before it signs them out or removes anything (FR8.1)', async () => {
    await deps.store.createPlan(queuedPlan());
    cognitoMock.on(AdminDisableUserCommand).rejects(new Error('Throttled'));
    expect(await runAdmin(['delete-account', EMAIL], deps)).toBe(1);
    expect(await deps.store.isAccountDeleted(ALICE)).toBe(true);
    expect(table.itemsMentioning('PLAN#')).toHaveLength(1); // nothing removed yet, and the API already refuses
  });

  it('does not affect another, live user', async () => {
    const bobs = queuedPlan({ userId: BOB });
    await deps.store.createPlan(bobs);
    await deps.store.createPlan(queuedPlan());
    expect(await runAdmin(['delete-account', EMAIL], deps)).toBe(0);
    expect(await deps.store.isAccountDeleted(BOB)).toBe(false);
    expect(await deps.store.getPlan(BOB, bobs.planId)).toBeDefined();
  });
});

describe('admin delete-account --sub (re-run of the cleanup by user id, FR8.1)', () => {
  it('removes items written after the first cleanup, reading every page, and keeps only the marker', async () => {
    cognitoMock.on(AdminDisableUserCommand).resolves({});
    cognitoMock.on(AdminUserGlobalSignOutCommand).resolves({});
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
    expect(await runAdmin(['delete-account', EMAIL], deps)).toBe(0);
    // Items left behind under the user id, for example by a first run that stopped part-way. (A request in flight
    // can no longer write them: its writes are checked against the marker, see the R-08 tests in api.test.ts.)
    for (const plan of [queuedPlan(), queuedPlan()]) {
      table.put({ pk: `USER#${ALICE}`, sk: `PLAN#${plan.planId}`, entity: 'plan', ...plan });
    }
    table.put({ pk: `USER#${ALICE}`, sk: 'IDEM#late', planId: 'x' });
    table.put({ pk: `USER#${ALICE}`, sk: 'QUOTA#2026-10', count: 1 });
    table.setQueryPageSize(1);
    const cognitoCalls = cognitoMock.calls().length;

    expect(await runAdmin(['delete-account', '--sub', ALICE], deps)).toBe(0);
    expect(table.itemsMentioning(ALICE).map((item) => item.sk)).toEqual(['DELETED']);
    expect(out.at(-1)).toContain('2 plan(s), 1 retry key(s) and 1 monthly count item(s)');
    expect(cognitoMock.calls()).toHaveLength(cognitoCalls); // Cognito is not touched
  });

  it('marks a user id that was never cleaned up, without needing the email', async () => {
    await deps.store.createPlan(queuedPlan());
    expect(await runAdmin(['delete-account', '--sub', ` ${ALICE} `], deps)).toBe(0);
    expect(await deps.store.isAccountDeleted(ALICE)).toBe(true);
    expect(table.itemsMentioning('PLAN#')).toEqual([]);
  });

  it('refuses a missing or malformed user id with exit code 2 and touches nothing', async () => {
    expect(await runAdmin(['delete-account', '--sub'], deps)).toBe(2);
    expect(err.at(-1)).toBe(USAGE);
    expect(await runAdmin(['delete-account', '--sub', 'USER#x'], deps)).toBe(2);
    expect(err.at(-1)).toContain('not a valid user id');
    expect(table.items.size).toBe(0);
  });

  it('reports a storage failure with exit code 1', async () => {
    table.failNext('Put', named('AccessDeniedException'));
    expect(await runAdmin(['delete-account', '--sub', ALICE], deps)).toBe(1);
    expect(err.at(-1)).toMatch(/^Refused: your AWS credentials are not allowed/);
    table.failNext('Query', new Error('InternalServerError'));
    expect(await runAdmin(['delete-account', '--sub', ALICE], deps)).toBe(1);
    expect(err.at(-1)).toContain('delete-account --sub failed: Error: InternalServerError');
  });
});
