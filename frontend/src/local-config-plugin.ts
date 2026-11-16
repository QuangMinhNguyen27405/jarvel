// Local development only: part of the Vite dev server (see vite.config.ts), never of the built web app.
import type { Connect, Plugin } from 'vite';
import { LOCAL_CONFIG } from './config.js';

/**
 * Answers /config.json with the local development settings and passes every other request on. Without it the web
 * app still starts in local mode, but the browser console shows a 404 for /config.json on every page load.
 */
export const serveLocalConfig: Connect.NextHandleFunction = (req, res, next) => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/config.json' || (req.method !== 'GET' && req.method !== 'HEAD')) {
    next();
    return;
  }
  const body = JSON.stringify(LOCAL_CONFIG);
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(req.method === 'HEAD' ? undefined : body);
};

/**
 * Serves the local development settings at /config.json while `vite` (the dev server) runs. It is registered after
 * Vite's own handlers, so a real `frontend/public/config.json` (for pointing the local web app at a deployed API)
 * is served first and this never replaces it.
 */
export function localConfig(): Plugin {
  return {
    name: 'jarvel-local-config',
    apply: 'serve',
    configureServer: (server) => () => {
      server.middlewares.use(serveLocalConfig);
    },
  };
}
