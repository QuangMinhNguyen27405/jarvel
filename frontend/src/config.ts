import type { FrontendConfig } from '@jarvel/shared';

const DEV_API_URL = 'http://localhost:8787';

/** Local development mode: a name-only sign-in against the local dev API (`npm run dev -w @jarvel/backend`). */
export const LOCAL_CONFIG: Readonly<FrontendConfig> = Object.freeze({
  region: '',
  apiUrl: DEV_API_URL,
  userPoolId: '',
  userPoolClientId: '',
  mock: true,
});

/**
 * Reads /config.json (written at deploy time, never committed). Without it, or with `mock: true`, the app runs in
 * local development mode. The local web server (`npm run dev -w @jarvel/frontend`) answers /config.json with
 * LOCAL_CONFIG itself when there is no `public/config.json`, so the browser console stays free of a 404.
 */
export async function loadConfig(fetchFn: typeof fetch = (...args) => fetch(...args)): Promise<FrontendConfig> {
  try {
    const response = await fetchFn('/config.json', { headers: { accept: 'application/json' } });
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && type.includes('json')) return (await response.json()) as FrontendConfig;
  } catch {
    // fall through to local development mode
  }
  return { ...LOCAL_CONFIG };
}
