import nextConfig from 'eslint-config-next';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'import': importPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: ['app/**/*', 'components/**/*'],
              from: 'lib/db/server.ts',
              message: 'Importing lib/db/server.ts in client-side code is forbidden.'
            }
          ]
        }
      ]
    }
  }
];

export default eslintConfig;
