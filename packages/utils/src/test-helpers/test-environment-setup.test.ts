/**
 * Tests for test environment setup utilities
 */

import { describe, it, expect } from 'vitest';
import {
  checkPythonEnvironment,
  checkDuckDBEnvironment,
  checkClickHouseEnvironment,
  checkAllEnvironments,
} from './test-environment-setup.js';

describe('Test Environment Setup', () => {
  it('should check Python environment', () => {
    const env = checkPythonEnvironment();
    expect(env).toHaveProperty('python3Available');
    expect(env).toHaveProperty('dependenciesInstalled');
  });

  it('should check DuckDB environment', () => {
    const env = checkDuckDBEnvironment();
    expect(env).toHaveProperty('duckdbAvailable');
    expect(env).toHaveProperty('testDbPath');
    expect(env).toHaveProperty('writeable');
  });

  it('should check ClickHouse environment', () => {
    const env = checkClickHouseEnvironment();
    expect(env).toHaveProperty('clickhouseAvailable');
    expect(env).toHaveProperty('host');
    expect(env).toHaveProperty('port');
    expect(env).toHaveProperty('database');
  });

  it('should check all environments', () => {
    const status = checkAllEnvironments();
    expect(status).toHaveProperty('python');
    expect(status).toHaveProperty('duckdb');
    expect(status).toHaveProperty('clickhouse');
    expect(status).toHaveProperty('allReady');
  });
});
