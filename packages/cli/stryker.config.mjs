/**
 * @type {import('@stryker-mutator/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress', 'json'],
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  
  // Focus on critical security components
  mutate: [
    'src/core/address-validator.ts',
    'src/core/argument-parser.ts',
    'src/core/error-handler.ts',
    'src/core/command-registry.ts',
  ],
  
  // Test files
  testRunnerNodeArgs: ['--experimental-vm-modules'],
  
  // Mutation score thresholds
  thresholds: {
    high: 90,
    low: 80,
    break: 75,
  },
  
  // Ignore patterns
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    'tests',
    '*.test.ts',
    '*.spec.ts',
  ],
  
  // Timeouts
  timeoutMS: 60000,
  timeoutFactor: 2,
  
  // Concurrency
  concurrency: 4,
  
  // Incremental mode for faster runs
  incremental: true,
  incrementalFile: '.stryker-tmp/incremental.json',
  
  // Plugins
  plugins: [
    '@stryker-mutator/vitest-runner',
  ],
  
  // Vitest config
  vitest: {
    configFile: 'vitest.config.ts',
  },
  
  // Mutation types to enable
  mutator: {
    plugins: ['typescript'],
    excludedMutations: [
      // Keep these mutations enabled for security-critical code
      // 'ArithmeticOperator',
      // 'BlockStatement',
      // 'BooleanLiteral',
      // 'ConditionalExpression',
      // 'EqualityOperator',
      // 'LogicalOperator',
      // 'StringLiteral',
      
      // Disable noisy mutations
      'ArrayDeclaration',
      'ObjectLiteral',
    ],
  },
  
  // HTML report output
  htmlReporter: {
    fileName: 'mutation-report.html',
  },
  
  // JSON report output
  jsonReporter: {
    fileName: 'mutation-report.json',
  },
};

