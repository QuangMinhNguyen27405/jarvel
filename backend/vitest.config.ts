import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Fake credentials: if anything ever reached a real AWS endpoint it would be refused, never billed.
    // Every AWS client in the suite is mocked with aws-sdk-client-mock; the AI model is a fake.
    env: {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test-fake-key',
      AWS_SECRET_ACCESS_KEY: 'test-fake-secret',
      AWS_EC2_METADATA_DISABLED: 'true',
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['scripts/dev-server.ts'], // local-only server, exercised by hand
      thresholds: { lines: 80 },
    },
  },
});
