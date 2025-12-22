import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Base TS rules
  {
    files: ['**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    settings: {
      // Helps eslint-plugin-import resolve TS path aliases
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json'],
        },
      },
    },
    rules: {
      // Security: No any types in production code (warn for now, error later)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-require-imports': 'off', // Allow require() for CommonJS interop

      // Code quality
      'no-console': 'off', // Allow globally for now; we will enforce for handlers/hotpath
      'no-useless-escape': 'warn',
      'no-fallthrough': 'warn',
      'no-case-declarations': 'warn',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',

      /**
       * Boundary guardrails (enforced as error)
       *
       * Rule: do not deep-import other packages' internal paths (src, dist, build, lib).
       * Use their public API (package entry / index.ts) or relative imports inside same package.
       *
       * This makes boundaries physical, not aspirational.
       */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@quantbot/*/src/**',
                '@quantbot/*/dist/**',
                '@quantbot/*/build/**',
                '@quantbot/*/lib/**',
              ],
              message:
                "Do not deep-import another package's internals. Import from its public API (e.g., @quantbot/<pkg>) instead.",
            },
          ],
        },
      ],

      /**
       * Zone-based path restrictions (enforced)
       * Prevent "libraries" from importing CLI/TUI internals.
       */
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // Prevent other packages (excluding CLI) from importing CLI internals
            {
              target: [
                './packages/analytics/src/**',
                './packages/api-clients/src/**',
                './packages/core/src/**',
                './packages/events/src/**',
                './packages/ingestion/src/**',
                './packages/jobs/src/**',
                './packages/observability/src/**',
                './packages/ohlcv/src/**',
                './packages/simulation/src/**',
                './packages/storage/src/**',
                './packages/utils/src/**',
                './packages/workflows/src/**',
              ],
              from: './packages/cli/src',
              message:
                'Packages must not import from CLI internals. CLI is an app boundary.',
            },
            // Prevent other packages (excluding TUI) from importing TUI internals
            {
              target: [
                './packages/analytics/src/**',
                './packages/api-clients/src/**',
                './packages/cli/src/**',
                './packages/core/src/**',
                './packages/events/src/**',
                './packages/ingestion/src/**',
                './packages/jobs/src/**',
                './packages/observability/src/**',
                './packages/ohlcv/src/**',
                './packages/simulation/src/**',
                './packages/storage/src/**',
                './packages/utils/src/**',
                './packages/workflows/src/**',
              ],
              from: './packages/tui/src',
              message:
                'Packages must not import from TUI internals. TUI is an app boundary.',
            },
            // Prevent packages from importing another package's tests
            {
              target: './packages/*/src/**',
              from: './packages/**/tests',
              message:
                'Do not import across package tests. Tests are not part of the public API.',
            },
          ],
        },
      ],
    },
  },

  // Test files: relax (but keep architecture boundaries)
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.fuzz.ts', '**/*.property.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
      'no-restricted-properties': 'off',
      // KEEP no-restricted-imports ON so tests don't become an architecture bypass.
      // Tests can still use any, unused vars, console, etc., but must respect package boundaries.
      // 'no-restricted-imports': 'off',
    },
  },

  /**
   * Architectural Import Firewall
   * Existing rules kept (your current intent).
   */
  {
    files: ['packages/simulation/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@quantbot/storage*',
            '@quantbot/api-clients*',
            '@quantbot/ohlcv*',
            '@quantbot/ingestion*',
            '**/axios',
            'axios',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ohlcv/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@quantbot/simulation*'],
        },
      ],
    },
  },
  {
    files: ['packages/storage/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@quantbot/api-clients*'],
        },
      ],
    },
  },

  // Workflow boundaries: enforce clean separation
  {
    files: ['packages/workflows/src/**/*.ts'],
    ignores: [
      'packages/workflows/src/**/context/**/*.ts',
      'packages/workflows/src/**/adapters/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@quantbot/cli',
              message:
                'Workflows cannot depend on CLI. Use WorkflowContext for all dependencies.',
            },
            {
              name: '@quantbot/tui',
              message:
                'Workflows cannot depend on TUI. Use WorkflowContext for all dependencies.',
            },
            {
              name: '@quantbot/api-clients',
              message:
                'Workflows must use ctx.ports.marketData, not direct API client imports. Use ports for all external dependencies.',
            },
            {
              name: '@quantbot/storage/src/postgres',
              message:
                'Use WorkflowContext repos, not direct Postgres imports',
            },
            {
              name: '@quantbot/storage/src/clickhouse',
              message:
                'Use WorkflowContext repos, not direct ClickHouse imports',
            },
            {
              name: '@quantbot/storage/src/duckdb',
              message: 'Use WorkflowContext repos, not direct DuckDB imports',
            },
          ],
          patterns: [
            {
              group: ['@quantbot/cli*', '@quantbot/tui*'],
              message:
                'Workflows cannot import from CLI or TUI packages',
            },
            {
              group: ['@quantbot/api-clients*'],
              message:
                'Workflows must use ctx.ports.marketData, not direct API client imports. Use ports for all external dependencies.',
            },
            {
              group: [
                '@quantbot/storage/src/**',
              ],
              message:
                'Workflows must use WorkflowContext or ports, not direct storage implementation imports',
            },
            {
              group: [
                'axios',
                '**/axios',
                'node-fetch',
                '**/node-fetch',
              ],
              message:
                'Workflows must use ports, not direct HTTP client imports',
            },
          ],
        },
      ],
    },
  },

  // TEMP QUARANTINE: Known violations during migration
  // ⚠️ MUST BE REMOVED after PR #X (ingestTelegramJson migration)
  // This file is being migrated to ports-based architecture.
  // Once migrated, this override will be removed and full enforcement restored.
  {
    files: [
      'packages/workflows/src/telegram/ingestTelegramJson.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'warn', // Downgrade to warn (not error) for these specific files
        {
          paths: [
            {
              name: '@quantbot/api-clients',
              message:
                'TEMPORARY: This file is being migrated to ports. Use ctx.ports.marketData instead. Will be enforced after migration PR.',
            },
          ],
          patterns: [
            {
              group: ['@quantbot/api-clients*'],
              message:
                'TEMPORARY: This file is being migrated to ports. Use ctx.ports.marketData instead. Will be enforced after migration PR.',
            },
          ],
        },
      ],
    },
  },

  // CLI command boundaries: prevent importing workflow internals
  {
    files: ['packages/cli/src/commands/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@quantbot/workflows/src',
              message:
                'CLI commands can only import from @quantbot/workflows public API (index.ts)',
            },
          ],
          patterns: [
            {
              group: ['@quantbot/workflows/src/**'],
              message:
                'CLI commands cannot import workflow internals. Use public API only.',
            },
          ],
        },
      ],
    },
  },

  /**
   * Handler purity enforcement (this is the big one)
   *
   * Applies ONLY to pure handlers in packages/core/src/handlers.
   * CLI/TUI "handlers" are actually composition roots (packages/cli/src/commands/)
   * and are allowed to do I/O.
   *
   * Pure handlers must:
   * - No env reads
   * - No wall-clock (use ClockPort)
   * - No randomness (use injected RNG)
   * - No filesystem
   * - No direct logging
   * - May only import from @quantbot/core domain/ports/commands
   *
   * Exceptions are handled below (context/adapters/infra/bin can do I/O).
   */
  {
    files: [
      'packages/core/src/handlers/**/*.ts', // Pure handlers only - sacred zone
    ],
    rules: {
      'no-console': 'error',

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // Runtime / OS
            'fs',
            'node:fs',
            'path',
            'node:path',
            'os',
            'node:os',

            // Config + env loading
            'dotenv',
            'dotenv/config',

            // HTTP clients / network (force ports/adapters)
            'axios',
            '**/axios',

            // Logging frameworks (handlers return structured telemetry instead)
            'winston',
            'winston*',
          ],
          paths: [
            {
              name: '@quantbot/workflows',
              message: 'Pure handlers must not import workflows. Use ports.',
            },
            {
              name: '@quantbot/storage',
              message: 'Pure handlers must not import storage. Use ports.',
            },
            {
              name: '@quantbot/api-clients',
              message: 'Pure handlers must not import API clients. Use ports.',
            },
          ],
        },
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Handlers must not read process.env. Accept config via ports/context.',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            'Handlers must not use Date.now(). Use a ClockPort / injected clock.',
        },
        {
          object: 'Math',
          property: 'random',
          message:
            'Handlers must not use Math.random(). Use an injected RNG / deterministic seed.',
        },
      ],
    },
  },

  /**
   * Composition roots + adapters are allowed to do I/O
   * (you can tighten these later if you want).
   */
  {
    files: [
      'packages/**/src/**/context/**/*.ts',
      'packages/**/src/**/adapters/**/*.ts',
      'packages/**/src/**/infra/**/*.ts',
      'packages/**/src/**/bin/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
      'no-restricted-properties': 'off',
    },
  },

  /**
   * Hot path sterility (future-proof)
   * If/when you add packages/hotpath, these become "hard constraints".
   */
  {
    files: ['packages/**/hotpath/**/*.ts', 'packages/hotpath/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // OS / runtime
            'fs',
            'node:fs',
            'path',
            'node:path',
            'os',
            'node:os',
            'dotenv',
            'dotenv/config',

            // Network + heavy deps
            'axios',
            '**/axios',
            'winston',
            'winston*',
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env' },
        { object: 'Date', property: 'now' },
        { object: 'Math', property: 'random' },
      ],
    },
  },

  // Ignore set (kept from your config, minor expansion)
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'scripts/**', // legacy scripts
      'examples/**',
      'templates/**',
      'web/**',
    ],
  }
);
