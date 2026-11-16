import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { localConfig } from './src/local-config-plugin.js';

export default defineConfig({
  plugins: [react(), localConfig()],
  server: { port: 5173 },
  test: { environment: 'jsdom', globals: false, setupFiles: ['./src/test-setup.ts'] },
});
