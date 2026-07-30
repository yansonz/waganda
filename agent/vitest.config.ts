import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@waganda/schemas': fileURLToPath(
        new URL('../packages/schemas/src/index.ts', import.meta.url),
      ),
      '@app': fileURLToPath(new URL('../lib', import.meta.url)),
      '@': fileURLToPath(new URL('..', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
