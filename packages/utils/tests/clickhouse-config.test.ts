import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getClickHouseConfig, getClickHouseDatabaseName } from '@quantbot/utils';

describe('ClickHouse config helpers', () => {
  beforeEach(() => {
    vi.stubEnv('CLICKHOUSE_DATABASE', 'test-db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the database name consistent with the ClickHouse config', () => {
    const config = getClickHouseConfig();
    const database = getClickHouseDatabaseName();

    expect(config.database).toEqual(database);
  });
});
