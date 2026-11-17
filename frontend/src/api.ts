import type {
  ApiErrorBody,
  CreatePlanResponse,
  HotelInfo,
  ListPlansResponse,
  PlanRecord,
  PlanSummary,
  TripPreferences,
  TripRequest,
} from '@jarvel/shared';

/** What the form sends: the server fills the nearest station and the default preferences. */
export type CreatePlanInput = Omit<TripRequest, 'hotel' | 'preferences'> & {
  hotel: Pick<HotelInfo, 'name' | 'address' | 'lat' | 'lng'>;
  preferences?: Partial<TripPreferences>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Partial<ApiErrorBody>,
  ) {
    super(body.error ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }

  /** "field: message" lines for a 400, or an empty list. */
  get fieldMessages(): string[] {
    return (this.body.fields ?? []).map((f) => `${f.field}: ${f.message}`);
  }
}

/** The local dev server's demo account: its sign-in name and its trip (null until the trip is accepted). */
export interface DemoAccount {
  user: string;
  planId: string | null;
}

/**
 * Asks the local dev server for its demo account (`GET /dev/demo`, local development only). Null when the server
 * has none, cannot be reached or answers anything else, so the sign-in page then stays as it is without one.
 */
export async function fetchDemoAccount(
  apiUrl: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<DemoAccount | null> {
  try {
    const response = await fetchFn(`${apiUrl}/dev/demo`, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: unknown; planId?: unknown } | null;
    if (typeof body?.user !== 'string' || body.user === '') return null;
    return { user: body.user, planId: typeof body.planId === 'string' ? body.planId : null };
  } catch {
    return null;
  }
}

export interface PlanApi {
  list(): Promise<PlanSummary[]>;
  get(planId: string): Promise<PlanRecord>;
  create(request: CreatePlanInput): Promise<CreatePlanResponse>;
  rename(planId: string, title: string): Promise<PlanRecord>;
  remove(planId: string): Promise<void>;
}

export function createPlanApi(
  apiUrl: string,
  getToken: () => Promise<string>,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): PlanApi {
  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const response = await fetchFn(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await getToken()}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined;
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ApiError(response.status, { error: `Unexpected answer from the server (${response.status}).` });
    }
    if (!response.ok) throw new ApiError(response.status, (parsed ?? {}) as Partial<ApiErrorBody>);
    return parsed;
  }
  return {
    list: async () => ((await call('GET', '/plans')) as ListPlansResponse).plans,
    get: async (planId) => (await call('GET', `/plans/${planId}`)) as PlanRecord,
    create: async (request) =>
      (await call('POST', '/plans', request, { 'idempotency-key': crypto.randomUUID() })) as CreatePlanResponse,
    rename: async (planId, title) => (await call('PATCH', `/plans/${planId}`, { title })) as PlanRecord,
    remove: async (planId) => {
      await call('DELETE', `/plans/${planId}`);
    },
  };
}
