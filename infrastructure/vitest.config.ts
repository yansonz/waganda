import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // cdk synth 는 느리므로 여유를 둔다
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
