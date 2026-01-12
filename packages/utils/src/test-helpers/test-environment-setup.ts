/**
 * Test Environment Setup Utilities
 *
 * Provides automatic environment setup for integration tests.
 * Tests can use these utilities to ensure required services and dependencies
 * are available before running.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { findWorkspaceRoot } from '../fs/workspace-root.js';

export interface PythonEnvironment {
  python3Available: boolean;
  python3Version?: string;
  venvPath?: string;
  dependenciesInstalled: boolean;
}

export interface DuckDBEnvironment {
  duckdbAvailable: boolean;
  testDbPath: string;
  writeable: boolean;
}

export interface ClickHouseEnvironment {
  clickhouseAvailable: boolean;
  host: string;
  port: number;
  database: string;
}

/**
 * Check if Python 3 is available and get version
 */
export function checkPythonEnvironment(): PythonEnvironment {
  const workspaceRoot = findWorkspaceRoot();
  const venvPath = join(workspaceRoot, 'venv');

  try {
    const version = execSync('python3 --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const python3Available = true;

    // Check if venv exists
    const venvExists = existsSync(venvPath);

    // Check if required Python packages are installed
    let dependenciesInstalled = false;
    if (python3Available) {
      try {
        // Try importing key dependencies
        execSync('python3 -c "import duckdb; import pydantic"', {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        dependenciesInstalled = true;
      } catch {
        dependenciesInstalled = false;
      }
    }

    return {
      python3Available,
      python3Version: version,
      venvPath: venvExists ? venvPath : undefined,
      dependenciesInstalled,
    };
  } catch {
    return {
      python3Available: false,
      dependenciesInstalled: false,
    };
  }
}

/**
 * Setup Python environment (install dependencies if needed)
 */
export async function setupPythonEnvironment(): Promise<PythonEnvironment> {
  const env = checkPythonEnvironment();

  if (!env.python3Available) {
    throw new Error(
      'Python 3 is not available. Please install Python 3.8+ to run integration tests.'
    );
  }

  if (!env.dependenciesInstalled) {
    console.warn('[test-setup] Python dependencies not found. Attempting to install...');
    const workspaceRoot = findWorkspaceRoot();

    try {
      // Try to install dependencies
      execSync('pip3 install duckdb pydantic', {
        encoding: 'utf-8',
        stdio: 'inherit',
        cwd: workspaceRoot,
      });
      return checkPythonEnvironment();
    } catch (error) {
      console.warn(
        '[test-setup] Failed to install Python dependencies automatically.',
        'Please run: pip3 install -r requirements.txt (if available) or install manually'
      );
      throw error;
    }
  }

  return env;
}

/**
 * Check DuckDB environment
 */
export function checkDuckDBEnvironment(testDbPath?: string): DuckDBEnvironment {
  const workspaceRoot = findWorkspaceRoot();
  const dbPath = testDbPath || join(workspaceRoot, 'data', 'test.duckdb');

  // Check if we can write to the directory
  const dbDir = join(dbPath, '..');
  let writeable = false;
  try {
    const testFile = join(dbDir, '.test-write');
    require('fs').writeFileSync(testFile, 'test');
    require('fs').unlinkSync(testFile);
    writeable = true;
  } catch {
    writeable = false;
  }

  // Check if DuckDB Python module is available (for Python-based tests)
  let duckdbAvailable = false;
  try {
    execSync('python3 -c "import duckdb"', {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    duckdbAvailable = true;
  } catch {
    duckdbAvailable = false;
  }

  return {
    duckdbAvailable,
    testDbPath: dbPath,
    writeable,
  };
}

/**
 * Check ClickHouse environment
 */
export function checkClickHouseEnvironment(): ClickHouseEnvironment {
  const host = process.env.CLICKHOUSE_HOST || 'localhost';
  const port = parseInt(process.env.CLICKHOUSE_PORT || '18123', 10);
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  let clickhouseAvailable = false;
  try {
    const response = execSync(`curl -s http://${host}:${port}/ping`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 2000,
    });
    clickhouseAvailable = response.trim() === 'Ok.';
  } catch {
    clickhouseAvailable = false;
  }

  return {
    clickhouseAvailable,
    host,
    port,
    database,
  };
}

/**
 * Setup ClickHouse environment (start via Docker Compose if needed)
 */
export async function setupClickHouseEnvironment(): Promise<ClickHouseEnvironment> {
  const env = checkClickHouseEnvironment();

  if (!env.clickhouseAvailable) {
    const workspaceRoot = findWorkspaceRoot();
    const dockerComposePath = join(workspaceRoot, 'docker-compose.yml');

    if (existsSync(dockerComposePath)) {
      console.warn(
        '[test-setup] ClickHouse not available. Attempting to start via Docker Compose...'
      );
      try {
        execSync('docker-compose up -d clickhouse', {
          encoding: 'utf-8',
          stdio: 'inherit',
          cwd: workspaceRoot,
        });

        // Wait for ClickHouse to be ready
        let retries = 30;
        while (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const check = checkClickHouseEnvironment();
          if (check.clickhouseAvailable) {
            return check;
          }
          retries--;
        }

        throw new Error('ClickHouse failed to start within 30 seconds');
      } catch (error) {
        console.warn(
          '[test-setup] Failed to start ClickHouse automatically.',
          'Please start manually: docker-compose up -d clickhouse'
        );
        throw error;
      }
    } else {
      throw new Error(
        'ClickHouse is not available and docker-compose.yml not found. ' +
          'Please start ClickHouse manually or set CLICKHOUSE_HOST/PORT environment variables.'
      );
    }
  }

  return env;
}

/**
 * Check if all required test environments are available
 */
export interface TestEnvironmentStatus {
  python: PythonEnvironment;
  duckdb: DuckDBEnvironment;
  clickhouse: ClickHouseEnvironment;
  allReady: boolean;
}

export function checkAllEnvironments(): TestEnvironmentStatus {
  const python = checkPythonEnvironment();
  const duckdb = checkDuckDBEnvironment();
  const clickhouse = checkClickHouseEnvironment();

  const allReady =
    python.python3Available &&
    python.dependenciesInstalled &&
    duckdb.duckdbAvailable &&
    duckdb.writeable &&
    clickhouse.clickhouseAvailable;

  return {
    python,
    duckdb,
    clickhouse,
    allReady,
  };
}

/**
 * Setup all test environments
 */
export async function setupAllEnvironments(): Promise<TestEnvironmentStatus> {
  const python = await setupPythonEnvironment();
  const duckdb = checkDuckDBEnvironment();
  const clickhouse = await setupClickHouseEnvironment();

  const allReady =
    python.python3Available &&
    python.dependenciesInstalled &&
    duckdb.duckdbAvailable &&
    duckdb.writeable &&
    clickhouse.clickhouseAvailable;

  return {
    python,
    duckdb,
    clickhouse,
    allReady,
  };
}

/**
 * Skip test if environment is not available (for use in test files)
 */
export function skipIfEnvironmentNotReady(env: TestEnvironmentStatus, reason?: string): void {
  if (!env.allReady) {
    const missing: string[] = [];
    if (!env.python.python3Available || !env.python.dependenciesInstalled) {
      missing.push('Python 3 with dependencies');
    }
    if (!env.duckdb.duckdbAvailable || !env.duckdb.writeable) {
      missing.push('DuckDB');
    }
    if (!env.clickhouse.clickhouseAvailable) {
      missing.push('ClickHouse');
    }

    const skipReason =
      reason ||
      `Missing required test environments: ${missing.join(', ')}. ` +
        'Run setupAllEnvironments() or set up manually.';

    // Use vitest's skip functionality
    if (typeof globalThis.describe !== 'undefined') {
      // In test context
      throw new Error(`SKIP: ${skipReason}`);
    } else {
      console.warn(`[test-setup] ${skipReason}`);
    }
  }
}
