import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', '.generated/', '.wrangler/', '.vercel/', 'local-secrets/']),
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  { files: ['web/**/*.tsx'], extends: [reactHooks.configs.flat.recommended] },
  prettier,
);
