import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Security: No any types in production code (warn for now, error later)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-require-imports': 'off', // Allow require() for CommonJS interop
      
      // Code quality
      'no-console': 'off', // Allow for now, will enforce in new code
      'no-useless-escape': 'warn', // Warn instead of error
      'no-fallthrough': 'warn', // Warn instead of error
      'no-case-declarations': 'warn', // Warn instead of error
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.fuzz.ts', '**/*.property.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
  // Architectural Import Firewall
  // Enforces clean separation: simulation (pure compute) vs ohlcv (data acquisition) vs storage (persistence)
  {
    files: ['packages/simulation/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '@quantbot/storage*',
          '@quantbot/api-clients*',
          '@quantbot/ohlcv*',
          '@quantbot/ingestion*',
          '**/axios',
          'axios',
        ],
      }],
    },
  },
  {
    files: ['packages/ohlcv/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '@quantbot/simulation*',
        ],
      }],
    },
  },
  {
    files: ['packages/storage/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '@quantbot/api-clients*',
        ],
      }],
    },
  },
  // Workflow boundaries: enforce clean separation
  // Workflows cannot import from CLI/TUI or storage implementations
  {
    files: ['packages/workflows/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@quantbot/cli',
            message: 'Workflows cannot depend on CLI. Use WorkflowContext for all dependencies.',
          },
          {
            name: '@quantbot/tui',
            message: 'Workflows cannot depend on TUI. Use WorkflowContext for all dependencies.',
          },
          {
            name: '@quantbot/storage/src/postgres',
            message: 'Use WorkflowContext repos, not direct Postgres imports',
          },
          {
            name: '@quantbot/storage/src/clickhouse',
            message: 'Use WorkflowContext repos, not direct ClickHouse imports',
          },
          {
            name: '@quantbot/storage/src/duckdb',
            message: 'Use WorkflowContext repos, not direct DuckDB imports',
          },
        ],
        patterns: [
          {
            group: ['@quantbot/cli*', '@quantbot/tui*'],
            message: 'Workflows cannot import from CLI or TUI packages',
          },
          {
            group: ['@quantbot/storage/src/**/postgres*', '@quantbot/storage/src/**/clickhouse*', '@quantbot/storage/src/**/duckdb*'],
            message: 'Workflows must use WorkflowContext, not direct storage implementation imports',
          },
        ],
      }],
    },
  },
  // CLI handler boundaries: prevent importing workflow internals
  {
    files: ['packages/cli/src/handlers/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@quantbot/workflows/src',
            message: 'CLI handlers can only import from @quantbot/workflows public API (index.ts)',
          },
        ],
        patterns: [
          {
            group: ['@quantbot/workflows/src/**'],
            message: 'CLI handlers cannot import workflow internals. Use public API only.',
          },
        ],
      }],
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'scripts/**', // Exclude all scripts for now (legacy code)
      'examples/**',
      'templates/**',
      'web/**',
    ],
  }
);
