import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // CDK synthesis can take a few seconds per stack.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'html'],
      include: ['bin/**/*.ts', 'lib/**/*.ts'],
      thresholds: { lines: 80 },
    },
  },
});
