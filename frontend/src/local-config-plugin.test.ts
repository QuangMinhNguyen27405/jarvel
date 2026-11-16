// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_CONFIG, loadConfig } from './config.js';
import { localConfig, serveLocalConfig } from './local-config-plugin.js';

type Handler = typeof serveLocalConfig;

/** Calls the handler with a stand-in request and records what it answered. */
function ask(url: string | undefined, method = 'GET') {
  const headers = new Map<string, string>();
  const answer = { statusCode: 0, body: undefined as string | undefined, ended: false, headers };
  const res = {
    set statusCode(code: number) {
      answer.statusCode = code;
    },
    setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    end: (body?: string) => {
      answer.body = body;
      answer.ended = true;
    },
  };
  const next = vi.fn();
  serveLocalConfig({ url, method } as Parameters<Handler>[0], res as unknown as Parameters<Handler>[1], next);
  return { answer, next };
}

describe('the local web server answers /config.json (Step 15)', () => {
  it('answers /config.json with the local development settings as JSON', () => {
    const { answer, next } = ask('/config.json');
    expect(next).not.toHaveBeenCalled();
    expect(answer.statusCode).toBe(200);
    expect(answer.headers.get('content-type')).toContain('application/json');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(answer.body ?? '')).toEqual(LOCAL_CONFIG);
  });

  it('answers the same when the address has a query string', () => {
    const { answer, next } = ask('/config.json?t=1');
    expect(next).not.toHaveBeenCalled();
    expect(JSON.parse(answer.body ?? '')).toEqual(LOCAL_CONFIG);
  });

  it('answers a HEAD request without a body', () => {
    const { answer, next } = ask('/config.json', 'HEAD');
    expect(next).not.toHaveBeenCalled();
    expect(answer.statusCode).toBe(200);
    expect(answer.ended).toBe(true);
    expect(answer.body).toBeUndefined();
  });

  it.each([
    ['/', 'GET'],
    ['/src/main.tsx', 'GET'],
    ['/config.json.map', 'GET'],
    ['/nested/config.json', 'GET'],
    ['/config.json', 'POST'],
    [undefined, 'GET'],
  ])('passes %s (%s) on untouched', (url, method) => {
    const { answer, next } = ask(url, method);
    expect(next).toHaveBeenCalledTimes(1);
    expect(answer.ended).toBe(false);
    expect(answer.statusCode).toBe(0);
  });

  it('is a dev-server-only plugin: it is not part of the built web app', () => {
    const plugin = localConfig();
    expect(plugin.name).toBe('jarvel-local-config');
    expect(plugin.apply).toBe('serve');
  });

  it('registers after the dev server’s own handlers, so a real public/config.json is served first', () => {
    const use = vi.fn();
    const hook = localConfig().configureServer as unknown as (server: unknown) => (() => void) | void;
    const after = hook({ middlewares: { use } });
    expect(use).not.toHaveBeenCalled();
    expect(typeof after).toBe('function');
    (after as () => void)();
    expect(use).toHaveBeenCalledWith(serveLocalConfig);
  });
});

describe('loadConfig', () => {
  const answering = (body: string, init: ResponseInit) => vi.fn<typeof fetch>(async () => new Response(body, init));

  it('uses a JSON /config.json as it is', async () => {
    const deployed = { region: 'us-east-1', apiUrl: 'https://api.example.com', userPoolId: 'p', userPoolClientId: 'c' };
    const fetchFn = answering(JSON.stringify(deployed), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(loadConfig(fetchFn)).resolves.toEqual(deployed);
    expect(fetchFn.mock.calls[0]![0]).toBe('/config.json');
  });

  it('falls back to local development mode when /config.json is missing', async () => {
    const config = await loadConfig(answering('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
    expect(config).toEqual(LOCAL_CONFIG);
    expect(config.mock).toBe(true);
  });

  it('falls back when the answer is a web page, not JSON (a single-page host answering every address)', async () => {
    const page = answering('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(loadConfig(page)).resolves.toEqual(LOCAL_CONFIG);
  });

  it('falls back when the request cannot be made at all', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(loadConfig(down)).resolves.toEqual(LOCAL_CONFIG);
  });

  it('hands out a copy, so a caller cannot change the shared local settings', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const config = await loadConfig(down);
    config.apiUrl = 'http://changed.example';
    expect(LOCAL_CONFIG.apiUrl).toBe('http://localhost:8787');
  });
});
