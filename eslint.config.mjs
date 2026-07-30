import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      '.next/**',
      // NEXT_DIST_DIR 로 분리한 프로덕션 산출물 (dev 와 충돌 방지용)
      '.next-prod/**',
      '.next-*/**',
      'node_modules/**',
      'agent/dist/**',
      'infrastructure/cdk.out/**',
      'audio/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

export default eslintConfig;
