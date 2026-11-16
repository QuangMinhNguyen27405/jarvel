// Local development server: the real ApiFn and PlannerFn code behind plain HTTP, with no AWS at all.
//   - Sign-in is fake: `Authorization: Bearer dev-<name>` signs in as user "<name>" (the web app's dev login does this).
//     The name may be an email address.
//   - DynamoDB is the in-memory fake table the tests use. Data is lost when the server stops.
//   - The AI model is a scripted stand-in that picks the wishlist places, then fills days from the catalog.
//   - It starts with a demo account (scripts/demo.ts) that already has one trip. `GET /dev/demo` names it, so the
//     web app's local sign-in can offer it. DEV_SEED_DEMO=0 starts empty.
//   - It listens on 127.0.0.1 only, so nobody else on the network can use it (R-09). HOST changes that.
// Never deploy this. It exists so the web app can be built and tried end to end at no cost.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { createApiHandler, type ApiEvent } from '../src/handlers/api.js';
import { DEFAULT_PRICES, TOOL_NAME, type ConverseFn } from '../src/lib/ai.js';
import { loadBostonData } from '../src/lib/data.js';
import { IdempotencyStore } from '../src/lib/idempotency.js';
import { createLogger, createMetrics } from '../src/lib/log.js';
import { runPlanner, type PlannerDeps } from '../src/lib/planner.js';
import { QuotaStore } from '../src/lib/quota.js';
import { PlanStore } from '../src/lib/store.js';
import { createFakeTable, TABLE_NAME } from '../test/fixtures/fake-dynamo.js';
import { DEMO_EMAIL, seedDemo } from './demo.js';

export const DEFAULT_PORT = 8787;
/** Loopback only: the server accepts connections from this computer and no other (R-09). */
export const DEFAULT_HOST = '127.0.0.1';

/** A local sign-in name: letters, digits and . _ @ + -, so an email address works. 1 to 80 characters. */
export const SIGN_IN_NAME_PATTERN = /^[A-Za-z0-9._@+-]{1,80}$/;

/** The user id the API sees for a local sign-in name, or undefined when the name is not allowed. */
export function devUserId(name: string): string | undefined {
  return SIGN_IN_NAME_PATTERN.test(name) ? `dev-${name}` : undefined;
}

/** What `GET /dev/demo` answers: the demo account's sign-in name and its trip, or nulls when there is none. */
export interface DemoAccount {
  user: string | null;
  planId: string | null;
}

/** A stand-in for Bedrock: reads the prompt the real planner sends and answers with a valid tool call. */
export function scriptedConverse(thinkMs = 3000): ConverseFn {
  return async (input) => {
    const text = (input.messages?.[0]?.content?.[0] as { text?: string } | undefined)?.text ?? '';
    const dates = /TRIP DATES: (.*)/.exec(text)?.[1]?.split(', ') ?? [];
    const wishlist = (/WISHLIST PLACE IDS: (.*)/.exec(text)?.[1] ?? '').split(', ').filter((id) => id && id[0] !== '(');
    const catalog = [...text.matchAll(/^([a-z0-9-]+) \| /gm)].map((match) => match[1]!);
    const chosen = [...new Set([...wishlist, ...catalog])];
    const maxPerDay = /at most (\d+) stops/.exec(text)?.[1] ? Number(/at most (\d+) stops/.exec(text)![1]) : 2;
    const perDay = Math.max(1, Math.min(maxPerDay, 2));
    const days = dates.map((date, index) => ({
      date,
      placeIds: index === 0 || index === dates.length - 1 ? [] : chosen.splice(0, perDay),
    }));
    // Make sure wishlist places are not dropped when the trip has no middle days.
    if (days.length > 0 && days.every((day) => day.placeIds.length === 0)) days[0]!.placeIds = chosen.splice(0, perDay);
    await new Promise((resolve) => setTimeout(resolve, thinkMs));
    const output: ConverseCommandOutput = {
      $metadata: {},
      output: {
        message: {
          role: 'assistant',
          content: [{ toolUse: { toolUseId: 'dev', name: TOOL_NAME, input: { days } as never } }],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
      metrics: { latencyMs: thinkMs },
    };
    return output;
  };
}

type Api = ReturnType<typeof createApiHandler>;

const ROUTES: { method: string; pattern: RegExp; routeKey: string }[] = [
  { method: 'GET', pattern: /^\/health$/, routeKey: 'GET /health' },
  { method: 'GET', pattern: /^\/plans$/, routeKey: 'GET /plans' },
  { method: 'POST', pattern: /^\/plans$/, routeKey: 'POST /plans' },
  { method: 'GET', pattern: /^\/plans\/([^/]+)$/, routeKey: 'GET /plans/{planId}' },
  { method: 'PATCH', pattern: /^\/plans\/([^/]+)$/, routeKey: 'PATCH /plans/{planId}' },
  { method: 'DELETE', pattern: /^\/plans\/([^/]+)$/, routeKey: 'DELETE /plans/{planId}' },
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key',
};

const SIGN_IN_PREFIX = 'Bearer dev-';

async function readRaw(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handle(
  api: Api,
  demoAccount: () => DemoAccount,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS).end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/dev/demo') {
    // Local server only, and no sign-in: it names the account the web app's "Use the demo account" button uses.
    const headers = { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    response.writeHead(200, headers).end(JSON.stringify(demoAccount()));
    return;
  }
  let routeKey = 'UNKNOWN';
  let planId: string | undefined;
  for (const route of ROUTES) {
    const match = route.pattern.exec(url.pathname);
    if (route.method === request.method && match) {
      routeKey = route.routeKey;
      planId = match[1];
    }
  }
  const auth = request.headers.authorization ?? '';
  const sub = auth.startsWith(SIGN_IN_PREFIX) ? devUserId(auth.slice(SIGN_IN_PREFIX.length)) : undefined;
  const event = {
    routeKey,
    headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, String(value)])),
    body: request.method === 'GET' || request.method === 'DELETE' ? undefined : await readRaw(request),
    isBase64Encoded: false,
    pathParameters: planId ? { planId } : undefined,
    queryStringParameters: Object.fromEntries(url.searchParams),
    requestContext: { authorizer: sub ? { jwt: { claims: { sub }, scopes: [] } } : undefined },
  } as unknown as ApiEvent;
  const result = await api(event);
  response.writeHead(result.statusCode ?? 200, { ...CORS, ...(result.headers as Record<string, string>) });
  response.end(result.body ?? '');
}

export interface DevServerOptions {
  /** How long the scripted AI stand-in "thinks" before it answers. */
  thinkMs?: number;
  /** `false` starts with no demo account and an empty table. Default: the demo account with its trip. */
  seedDemo?: boolean;
  /** The demo account's sign-in name. Default: `DEMO_EMAIL` from scripts/demo.ts. */
  demoEmail?: string;
  /** The clock. Default: the real one. A test sets it, so the demo trip's dates do not depend on the day it runs. */
  now?: () => Date;
}

export interface DevServer {
  server: Server;
  /** The demo account's sign-in name, or null when this server has none. */
  demoUser: string | null;
  /**
   * Settles when the demo trip is finished or could not be built, with what `GET /dev/demo` then answers. It never
   * rejects. With seeding off it is already settled with nulls.
   */
  demo: Promise<DemoAccount>;
  /** Stops the server, lets plans that are still being built finish, then removes the stand-in for DynamoDB. */
  close(): Promise<void>;
}

/**
 * The dev API with its own in-memory table, holding the demo account's trip unless `seedDemo` is false. Not
 * listening yet: call `server.listen(port, host)`.
 */
export function createDevServer(options: DevServerOptions = {}): DevServer {
  const table = createFakeTable();
  const data = loadBostonData();
  const log = createLogger({ service: 'dev' });
  const metrics = createMetrics('dev', () => {});
  const store = new PlanStore(table.doc, TABLE_NAME);
  const quota = new QuotaStore(table.doc, TABLE_NAME);
  const now = options.now ?? (() => new Date());
  const plannerDeps: PlannerDeps = {
    store,
    quota,
    data,
    converse: scriptedConverse(options.thinkMs),
    modelId: 'dev-scripted',
    prices: DEFAULT_PRICES,
    now,
    log,
    metrics,
  };
  /** Plans being built in the background. `close` waits for them, so none outlives the in-memory table. */
  const building = new Set<Promise<void>>();
  const api = createApiHandler({
    store,
    quota,
    idempotency: new IdempotencyStore(table.doc, TABLE_NAME),
    data,
    invokePlanner: async (payload) => {
      // Like InvocationType Event: return at once, build in the background.
      const built = new Promise<void>((resolve) => {
        setTimeout(() => {
          runPlanner(payload, plannerDeps)
            .catch((error) => log.error('planner crashed', { error }))
            .finally(resolve);
        }, 0);
      });
      building.add(built);
      void built.then(() => building.delete(built));
    },
    newPlanId: () => randomUUID(),
    now,
    log,
    metrics,
  });

  const account: DemoAccount = { user: null, planId: null };
  let demo: Promise<DemoAccount> = Promise.resolve(account);
  if (options.seedDemo !== false) {
    const name = options.demoEmail ?? DEMO_EMAIL;
    const userId = devUserId(name);
    if (userId === undefined) {
      log.error('no demo account: DEMO_EMAIL may only have letters, digits and . _ @ + - (1 to 80 characters)');
    } else {
      account.user = name;
      demo = seedDemo({
        api,
        userId,
        now,
        log,
        onAccepted: (planId) => {
          account.planId = planId;
        },
      }).then(() => account);
    }
  }

  const server = createServer((request, response) => {
    handle(api, () => account, request, response).catch((error) => {
      console.error(error);
      response.writeHead(500, CORS).end();
    });
  });
  const shutDown = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // The stand-in for DynamoDB is shared by every DynamoDB client in this process. It is removed only when
    // nothing is still writing, so a plan that is being built (the demo trip, for one) can never reach real AWS.
    await demo;
    while (building.size > 0) await Promise.all(building);
    table.mock.restore();
  };
  let closed: Promise<void> | undefined;
  return {
    server,
    demoUser: account.user,
    demo,
    close: () => (closed ??= shutDown()),
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST ?? DEFAULT_HOST;
  const dev = createDevServer({
    thinkMs: Number(process.env.DEV_PLANNER_DELAY_MS ?? 3000),
    seedDemo: process.env.DEV_SEED_DEMO !== '0',
  });
  dev.server.listen(port, host, () => {
    console.log(
      `Jarvel dev API on http://${host === DEFAULT_HOST ? 'localhost' : host}:${port}, this computer only ` +
        `unless HOST is set  (sign in with "Authorization: Bearer dev-<name>")`,
    );
    console.log(
      dev.demoUser === null
        ? 'No demo account (DEV_SEED_DEMO=0, or DEMO_EMAIL is not a usable sign-in name).'
        : `Demo account: ${dev.demoUser}  (the web app's "Use the demo account" button signs in as it; its trip ` +
            `is being built now. DEV_SEED_DEMO=0 starts without it.)`,
    );
  });
}
