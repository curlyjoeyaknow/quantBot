/**
 * Vitest Configuration for Trading Package Tests
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/', 'dist/'],
  },
  resolve: {
    alias: {
      '@quantbot/utils': path.resolve(__dirname, '../../utils/src'),
      '@quantbot/data': path.resolve(__dirname, '../../data/src'),
      '@quantbot/simulation': path.resolve(__dirname, '../../simulation/src'),
    },
  },
});

