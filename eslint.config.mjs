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
       *
       * Also enforces "No Live Trading" policy - QuantBot is simulation-only.
       * See docs/BOUNDARIES.md for the complete policy.
       */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@solana/web3.js',
              importNames: [
                'Keypair',
                'sendTransaction',
                'sendRawTransaction',
                'signTransaction',
                'signAllTransactions',
              ],
              message:
                'QuantBot is simulation-only. Do not import Solana signing/submission APIs. Use ExecutionPort for simulation instead. See docs/BOUNDARIES.md',
            },
          ],
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
            {
              group: [
                '@jito-*/**',
                'jito-*/**',
              ],
              message:
                'Jito clients enable live trading. QuantBot is simulation-only. See docs/BOUNDARIES.md',
            },
            // Note: We allow read-only imports like PublicKey for address validation
            // The CI check will catch actual signing/submission usage
            // If you need Solana types, prefer importing from @quantbot/core if available
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
   * Architectural Import Firewall - Layer Boundaries
   * Enforces separation of concerns as documented in docs/ARCHITECTURE_BOUNDARIES.md
   *
   * CRITICAL: Simulation must be deterministic. No Date.now(), new Date(), or Math.random() allowed.
   * Gate 1: Hard ban on nondeterminism - all time access must use SimulationClock, all randomness must use DeterministicRNG.
   */
  {
    files: ['packages/simulation/src/**/*.ts'],
    ignores: [
      // Allow Date.now() in progress/cache utilities (not simulation logic)
      'packages/simulation/src/utils/progress.ts',
      'packages/simulation/src/performance/result-cache.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@quantbot/storage',
              message:
                'Simulation (Strategy Logic layer) cannot import Storage (Infrastructure layer). Simulation must remain pure (no I/O). Use ports/interfaces from @quantbot/core instead.',
            },
            {
              name: '@quantbot/api-clients',
              message:
                'Simulation (Strategy Logic layer) cannot import API Clients (Data Ingestion layer). Simulation must remain pure (no network I/O). Use ports/interfaces from @quantbot/core instead.',
            },
            {
              name: '@quantbot/ohlcv',
              message:
                'Simulation (Strategy Logic layer) cannot directly import OHLCV (Feature Engineering layer). Use candle data via ports/interfaces from @quantbot/core instead.',
            },
            {
              name: '@quantbot/ingestion',
              message:
                'Simulation (Strategy Logic layer) cannot import Ingestion (Data Ingestion layer). Simulation must remain pure (no I/O).',
            },
            {
              name: '@quantbot/jobs',
              message:
                'Simulation (Strategy Logic layer) cannot import Jobs (Data Ingestion layer). Simulation must remain pure (no I/O).',
            },
            {
              name: '@quantbot/analytics',
              message:
                'Simulation (Strategy Logic layer) cannot import Analytics (Feature Engineering layer). Features feed simulation, not vice versa.',
            },
          ],
          patterns: [
            {
              group: [
                '@quantbot/storage*',
                '@quantbot/api-clients*',
                '@quantbot/ohlcv*',
                '@quantbot/ingestion*',
                '@quantbot/jobs*',
                '@quantbot/analytics*',
              ],
              message:
                'Simulation must remain pure (no I/O, no feature engineering imports). Use ports/interfaces from @quantbot/core instead.',
            },
            {
              group: ['**/axios', 'axios', 'node-fetch', '**/node-fetch'],
              message: 'Simulation must remain pure (no network I/O). Use ports/interfaces instead.',
            },
          ],
        },
      ],
      // Gate 1: Determinism enforcement - ban all non-deterministic time and randomness
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'Simulation must not use Date.now(). Use SimulationClock or injected clock for deterministic time. See packages/simulation/src/core/clock.ts',
        },
        {
          object: 'Math',
          property: 'random',
          message:
            'Simulation must not use Math.random(). Use DeterministicRNG from @quantbot/core for seeded randomness. See packages/core/src/determinism.ts',
        },
      ],
      // Ban new Date() constructor (non-deterministic)
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'Simulation must not use new Date(). Use SimulationClock or injected clock for deterministic time. See packages/simulation/src/core/clock.ts',
        },
      ],
    },
  },
  {
    files: ['packages/analytics/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@quantbot/api-clients',
              message:
                'Analytics (Feature Engineering layer) cannot import API Clients (Data Ingestion layer). Feature engineering works on existing data, not fetch new data. Use @quantbot/ohlcv for candle data instead.',
            },
            {
              name: '@quantbot/jobs',
              message:
                'Analytics (Feature Engineering layer) cannot import Jobs (Data Ingestion layer). Feature engineering works on existing data, not fetch new data.',
            },
            {
              name: '@quantbot/ingestion',
              message:
                'Analytics (Feature Engineering layer) cannot import Ingestion (Data Ingestion layer). Feature engineering works on existing data, not ingest new data.',
            },
            {
              name: '@quantbot/simulation',
              message:
                'Analytics (Feature Engineering layer) cannot import Simulation (Strategy Logic layer). Analytics feeds simulation, not vice versa. Only import result types if needed.',
            },
          ],
          patterns: [
            {
              group: ['@quantbot/api-clients*', '@quantbot/jobs*', '@quantbot/ingestion*'],
              message:
                'Feature Engineering layer cannot import Data Ingestion layer. Feature engineering works on existing data, not fetch/ingest new data.',
            },
            {
              group: ['@quantbot/simulation/src/**'],
              message:
                'Analytics cannot import simulation internals. Only import result types from @quantbot/simulation public API if needed.',
            },
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
          paths: [
            {
              name: '@quantbot/simulation',
              message:
                'OHLCV (Feature Engineering layer) cannot import Simulation (Strategy Logic layer). OHLCV feeds simulation, not vice versa.',
            },
            {
              name: '@quantbot/api-clients',
              message:
                'OHLCV (Feature Engineering layer) cannot import API Clients (Data Ingestion layer). OHLCV can only read data, not fetch new data. Use @quantbot/jobs for online fetching.',
            },
            {
              name: '@quantbot/jobs',
              message:
                'OHLCV (Feature Engineering layer) cannot import Jobs (Data Ingestion layer). OHLCV can only read data, not fetch new data. Jobs should use OHLCV, not the other way around.',
            },
          ],
          patterns: [
            {
              group: ['@quantbot/simulation*'],
              message:
                'OHLCV (Feature Engineering layer) cannot import Simulation (Strategy Logic layer). OHLCV feeds simulation, not vice versa.',
            },
            {
              group: ['@quantbot/api-clients*', '@quantbot/jobs*'],
              message:
                'OHLCV (Feature Engineering layer) cannot import Data Ingestion layer. OHLCV can only read data, not fetch new data.',
            },
          ],
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
      // Note: adapters should use clock from ports, but for now we allow Date.now() 
      // in adapters since they're composition roots. This will be tightened in the future.
      // 'packages/workflows/src/**/adapters/**/*.ts',
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
            {
              name: 'fs',
              message: 'Handlers must not import fs. Use adapters for file I/O.',
            },
            {
              name: 'node:fs',
              message: 'Handlers must not import fs. Use adapters for file I/O.',
            },
          ],
          patterns: [
            {
              group: ['@quantbot/cli*'],
              message:
                'Workflows cannot import from CLI packages',
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
            {
              group: [
                '@quantbot/simulation/src/**',
              ],
              message:
                'Workflows must use @quantbot/simulation public API (runOverlaySimulation), not deep imports. Do not bypass overlay-simulation.ts by calling simulateStrategy directly.',
            },
            {
              group: ['fs', 'node:fs'],
              message: 'Workflow handlers must not import fs. Use adapters for file I/O.',
            },
            {
              group: [
                '@quantbot/storage/src/duckdb',
                '@quantbot/storage/src/clickhouse',
              ],
              message:
                'Workflow handlers must not import DuckDB/ClickHouse clients directly. Use SliceExporter/SliceAnalyzer ports.',
            },
          ],
        },
      ],
      // Determinism enforcement: ban Date.now(), new Date(), and Math.random() in workflows
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'Workflows must not use Date.now(). Use ctx.clock.nowISO() or ports.clock.nowMs() for deterministic time. Only composition roots (context/adapters) may use Date.now() to create clock adapters.',
        },
        {
          object: 'Math',
          property: 'random',
          message:
            'Workflows must not use Math.random(). Use DeterministicRNG from @quantbot/core for seeded randomness.',
        },
      ],
      // Ban new Date() constructor (non-deterministic)
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'Workflows must not use new Date(). Use ctx.clock.nowISO() or ports.clock.nowMs() for deterministic time. Only composition roots may use new Date() to create clock adapters.',
        },
      ],
    },
  },

  // Adapter-specific rules: adapters should use clock from ports, not Date.now()
  // However, since adapters are created by composition roots, we allow Date.now() 
  // only in the factory functions that create clock adapters.
  {
    files: ['packages/workflows/src/**/adapters/**/*.ts'],
    ignores: [
      // Allow Date.now() only in composition root files that create clock adapters
      'packages/workflows/src/context/createProductionPorts.ts',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'Adapters must not use Date.now(). Accept a ClockPort dependency and use clock.nowMs() instead. Only composition roots (createProductionPorts.ts) may use Date.now() to create clock adapters.',
        },
        {
          object: 'Math',
          property: 'random',
          message:
            'Adapters must not use Math.random(). Use DeterministicRNG from @quantbot/core for seeded randomness.',
        },
      ],
      // Ban new Date() constructor in adapters
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'Adapters must not use new Date(). Accept a ClockPort dependency and use clock.nowMs() instead. Only composition roots may use new Date() to create clock adapters.',
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
            {
              name: '../core/execute',
              message:
                'Do not import execute() directly. Use defineCommand() wrapper instead. This ensures consistent normalization, coercion, and error handling.',
            },
            {
              name: '../core/argument-parser',
              message:
                'Do not import normalizeOptions directly. All normalization happens inside execute() which is called by defineCommand().',
            },
          ],
          patterns: [
            {
              group: ['@quantbot/workflows/src/**'],
              message:
                'CLI commands cannot import workflow internals. Use public API only.',
            },
            {
              group: ['**/core/execute', '**/core/argument-parser'],
              message:
                'Do not import execute() or normalizeOptions directly. Use defineCommand() wrapper instead. See packages/cli/src/core/README.md for the standard pattern.',
            },
          ],
        },
      ],
    },
  },

  // Core boundary: prevent importing execute/normalizeOptions outside core (except defineCommand)
  {
    files: ['packages/cli/src/**/*.ts'],
    ignores: [
      'packages/cli/src/core/**/*.ts', // Core can use these internally
      'packages/cli/src/commands/**/*.ts', // Commands are handled above
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../core/execute',
              message:
                'execute() must only be imported from defineCommand.ts. Use defineCommand() wrapper instead.',
            },
            {
              name: '../core/argument-parser',
              message:
                'normalizeOptions() must only be imported from execute.ts. Use defineCommand() wrapper instead.',
            },
          ],
          patterns: [
            {
              group: ['**/core/execute', '**/core/argument-parser'],
              message:
                'Do not import execute() or normalizeOptions directly. Use defineCommand() wrapper. See packages/cli/src/core/README.md.',
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

  /**
   * PythonEngine usage restriction
   *
   * PythonEngine may only be imported in:
   * - packages/storage/** (storage layer implementations)
   * - tools/storage/** (storage tooling scripts)
   * - packages/utils/** (PythonEngine is defined here)
   *
   * All other packages must use storage ports/services instead.
   * See docs/architecture/PYTHON_DB_DRIVER_DECISION.md for details.
   *
   * Note: ESLint cannot easily restrict specific named exports, so we rely on
   * the CI check (pnpm verify:python-engine) for enforcement. This rule
   * serves as a reminder/warning.
   */
  {
    files: [
      'packages/**/src/**/*.ts',
      'packages/**/tests/**/*.ts',
      'tools/**/*.ts',
    ],
    ignores: [
      'packages/storage/**', // Storage can use PythonEngine
      'tools/storage/**', // Storage tools can use PythonEngine
      'packages/utils/**', // PythonEngine is defined here
    ],
    rules: {
      // Note: We can't easily restrict specific named exports with ESLint,
      // so the CI check (verify:python-engine) is the primary enforcement.
      // This rule is kept as a reminder but won't catch all cases.
      'no-restricted-imports': [
        'warn', // Warning only - CI check is the real enforcement
        {
          patterns: [
            {
              group: [
                '@quantbot/utils/python/**',
                '**/python/python-engine',
              ],
              message:
                'PythonEngine may only be imported in packages/storage and tools/storage. Use storage ports/services instead. See docs/architecture/PYTHON_DB_DRIVER_DECISION.md. CI check will fail on violations.',
            },
          ],
        },
      ],
    },
  },

  /**
   * Live Trading Prevention: Simulation Lab Only
   *
   * QuantBot is a simulation lab only. It must never sign transactions or submit to networks.
   * These rules ban imports of live trading libraries and patterns.
   *
   * See docs/BOUNDARIES.md for the complete policy.
   *
   * Note: @solana/web3.js is NOT fully banned - only PublicKey (read-only) imports are allowed.
   * The CI check (check-no-live-trading) enforces PublicKey-only imports precisely.
   */
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@solana/spl-token',
              message:
                '@solana/spl-token may contain signing functions. QuantBot is simulation-only. Use read-only alternatives if needed.',
            },
            {
              name: '@jito-foundation/block-engine-client',
              message:
                '@jito-foundation/block-engine-client is for live trading. QuantBot is simulation-only.',
            },
            {
              name: '@solana/wallet-adapter',
              message:
                '@solana/wallet-adapter is for live trading. QuantBot is simulation-only.',
            },
            {
              name: '@solana/wallet-adapter-base',
              message:
                '@solana/wallet-adapter-base is for live trading. QuantBot is simulation-only.',
            },
            {
              name: '@solana/wallet-adapter-wallets',
              message:
                '@solana/wallet-adapter-wallets is for live trading. QuantBot is simulation-only.',
            },
          ],
          patterns: [
            {
              group: ['@solana/spl-token', '@jito-foundation/**', '@solana/wallet-adapter*'],
              message:
                'Live trading libraries are forbidden. QuantBot is simulation-only. See docs/BOUNDARIES.md',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="fromSecretKey"]',
          message:
            'Keypair.fromSecretKey() is forbidden. QuantBot does not load private keys. See docs/BOUNDARIES.md',
        },
        {
          selector: 'CallExpression[callee.property.name="sendTransaction"]',
          message:
            'sendTransaction() is forbidden. QuantBot does not submit transactions. See docs/BOUNDARIES.md',
        },
        {
          selector: 'CallExpression[callee.property.name="sendRawTransaction"]',
          message:
            'sendRawTransaction() is forbidden. QuantBot does not submit transactions. See docs/BOUNDARIES.md',
        },
        {
          selector: 'CallExpression[callee.property.name="signTransaction"]',
          message:
            'signTransaction() is forbidden. QuantBot does not sign transactions. See docs/BOUNDARIES.md',
        },
        {
          selector: 'CallExpression[callee.property.name="signAllTransactions"]',
          message:
            'signAllTransactions() is forbidden. QuantBot does not sign transactions. See docs/BOUNDARIES.md',
        },
        {
          selector:
            'MemberExpression[object.name="process"][property.name="env"] > Identifier[name=/PRIVATE|SECRET|MNEMONIC/i]',
          message:
            'Accessing process.env.*PRIVATE*, *SECRET*, or *MNEMONIC* is forbidden. QuantBot does not store private keys. See docs/BOUNDARIES.md',
        },
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
