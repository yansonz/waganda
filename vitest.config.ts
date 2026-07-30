import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * 경로 별칭은 플러그인 없이 직접 선언한다.
 * (vite-tsconfig-paths / @vitejs/plugin-react 는 vitest 가 번들한 vite 와
 *  다른 vite 메이저를 끌어와 타입·해석 충돌을 일으켜 제거했다.)
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@waganda\/schemas$/,
        replacement: fileURLToPath(new URL('./packages/schemas/src/index.ts', import.meta.url)),
      },
      {
        find: /^@waganda\/schemas\/(.*)$/,
        replacement: fileURLToPath(new URL('./packages/schemas/src/$1', import.meta.url)),
      },
      {
        find: /^@\/(.*)$/,
        replacement: fileURLToPath(new URL('./$1', import.meta.url)),
      },
    ],
  },
  // JSX 는 esbuild 의 automatic 런타임으로 변환한다 (React import 없이 tsx 테스트 가능).
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e', 'agent', 'infrastructure', 'audio'],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'components/**', 'app/api/**', 'packages/schemas/src/**'],
    },
  },
});
