/**
 * Artifact Writer
 *
 * Writes structured backtest artifacts with month-based partitioning.
 * Each run gets its own directory with typed Parquet files and a run.json manifest.
 *
 * Directory structure:
 *   runs/
 *     YYYY-MM/
 *       run_id=<uuid>/
 *         run.json              # Manifest
 *         inputs/
 *           alerts.parquet
 *         truth/
 *           paths.parquet
 *         features/
 *           features.parquet
 *         policy/
 *           trades.parquet
 *         results/
 *           summary.parquet
 *           frontier.parquet
 *         logs/
 *           stdout.txt
 *           stderr.txt
 *         errors/
 *           errors.parquet
 *         _SUCCESS              # Completion marker
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import { DuckDBClient } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { RunManifest, ArtifactType } from './types.js';
import { RunManifestSchema } from './types.js';

// =============================================================================
// Configuration
// =============================================================================

export interface ArtifactWriterConfig {
  /**
   * Base directory for all runs (default: 'runs')
   */
  baseDir?: string;
  
  /**
   * Whether to partition by month (default: true)
   */
  partitionByMonth?: boolean;
  
  /**
   * Whether to write _SUCCESS marker on completion (default: true)
   */
  writeSuccessMarker?: boolean;
}

const DEFAULT_CONFIG: Required<ArtifactWriterConfig> = {
  baseDir: 'runs',
  partitionByMonth: true,
  writeSuccessMarker: true,
};

// =============================================================================
// Run Directory Manager
// =============================================================================

export class RunDirectory {
  private readonly config: Required<ArtifactWriterConfig>;
  private readonly runId: string;
  private readonly runDir: string;
  private manifest: RunManifest;
  
  constructor(runId: string, runType: RunManifest['run_type'], config?: ArtifactWriterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.runId = runId;
    
    // Compute run directory path
    if (this.config.partitionByMonth) {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      this.runDir = join(this.config.baseDir, yearMonth, `run_id=${runId}`);
    } else {
      this.runDir = join(this.config.baseDir, `run_id=${runId}`);
    }
    
    // Initialize manifest
    this.manifest = {
      run_id: runId,
      run_type: runType,
      created_at: new Date().toISOString(),
      status: 'pending',
      schema_version: {
        manifest: '1.0.0',
        artifacts: '1.0.0',
      },
      dataset: {
        interval: '',
        calls_count: 0,
      },
      parameters: {},
      artifacts: {},
    };
  }
  
  /**
   * Get the run directory path
   */
  getRunDir(): string {
    return this.runDir;
  }
  
  /**
   * Get path for an artifact subdirectory
   */
  getArtifactDir(artifactType: ArtifactType): string {
    const subdir = this.getArtifactSubdir(artifactType);
    return join(this.runDir, subdir);
  }
  
  /**
   * Get subdirectory name for artifact type
   */
  private getArtifactSubdir(artifactType: ArtifactType): string {
    switch (artifactType) {
      case 'alerts':
        return 'inputs';
      case 'paths':
        return 'truth';
      case 'features':
        return 'features';
      case 'trades':
        return 'policy';
      case 'summary':
      case 'frontier':
        return 'results';
      case 'errors':
        return 'errors';
      default:
        return 'other';
    }
  }
  
  /**
   * Initialize run directory structure
   */
  async initialize(): Promise<void> {
    // Create all subdirectories
    await fs.mkdir(join(this.runDir, 'inputs'), { recursive: true });
    await fs.mkdir(join(this.runDir, 'truth'), { recursive: true });
    await fs.mkdir(join(this.runDir, 'features'), { recursive: true });
    await fs.mkdir(join(this.runDir, 'policy'), { recursive: true });
    await fs.mkdir(join(this.runDir, 'results'), { recursive: true });
    await fs.mkdir(join(this.runDir, 'logs'), { recursive: true });
    await fs.mkdir(join(this.runDir, 'errors'), { recursive: true });
    
    // Write initial manifest
    this.manifest.status = 'running';
    this.manifest.started_at = new Date().toISOString();
    await this.writeManifest();
    
    logger.info('Initialized run directory', { runId: this.runId, runDir: this.runDir });
  }
  
  /**
   * Write artifact data to Parquet
   */
  async writeArtifact(
    artifactType: ArtifactType,
    data: Array<Record<string, unknown>>
  ): Promise<string> {
    if (data.length === 0) {
      logger.debug('Skipping empty artifact', { runId: this.runId, artifactType });
      return '';
    }
    
    const artifactDir = this.getArtifactDir(artifactType);
    await fs.mkdir(artifactDir, { recursive: true });
    
    const filename = `${artifactType}.parquet`;
    const filepath = join(artifactDir, filename);
    
    try {
      // Write Parquet using DuckDB - execute all SQL in one batch to maintain connection
      const db = new DuckDBClient(':memory:');
      try {
        // Infer schema from first row
        const firstRow = data[0];
        const columns = Object.keys(firstRow);
        const columnDefs = columns
          .map((col) => {
            const value = firstRow[col];
            if (value === null || value === undefined) {
              return `${col} TEXT`;
            } else if (typeof value === 'number') {
              return Number.isInteger(value) ? `${col} BIGINT` : `${col} DOUBLE`;
            } else if (typeof value === 'boolean') {
              return `${col} BOOLEAN`;
            } else {
              return `${col} TEXT`;
            }
          })
          .join(', ');
        
        // Build all SQL statements
        const sqlStatements: string[] = [
          'INSTALL parquet;',
          'LOAD parquet;',
          `CREATE TABLE temp_data (${columnDefs});`,
        ];
        
        // Add INSERT statements
        for (const row of data) {
          const values = columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined) {
              return 'NULL';
            } else if (typeof val === 'string') {
              return `'${String(val).replace(/'/g, "''")}'`;
            } else if (typeof val === 'boolean') {
              return val ? 'TRUE' : 'FALSE';
            } else {
              return String(val);
            }
          });
          sqlStatements.push(
            `INSERT INTO temp_data (${columns.join(', ')}) VALUES (${values.join(', ')});`
          );
        }
        
        // Add COPY statement
        sqlStatements.push(`COPY temp_data TO '${filepath.replace(/'/g, "''")}' (FORMAT PARQUET);`);
        
        // Execute all statements as one batch
        const batchSql = sqlStatements.join('\n');
        await db.execute(batchSql);
      } finally {
        await db.close();
      }
      
      // Update manifest
      const relativePath = join(this.getArtifactSubdir(artifactType), filename);
      this.manifest.artifacts[artifactType] = {
        rows: data.length,
        path: relativePath,
      };
      await this.writeManifest();
      
      logger.info('Wrote artifact', {
        runId: this.runId,
        artifactType,
        rows: data.length,
        path: filepath,
      });
      
      return filepath;
    } catch (error) {
      logger.error('Failed to write artifact', {
        runId: this.runId,
        artifactType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  
  /**
   * Update manifest metadata
   */
  updateManifest(updates: Partial<RunManifest>): void {
    this.manifest = { ...this.manifest, ...updates };
  }
  
  /**
   * Write manifest to disk
   */
  async writeManifest(): Promise<void> {
    const manifestPath = join(this.runDir, 'run.json');
    
    // Validate manifest
    const validated = RunManifestSchema.parse(this.manifest);
    
    await fs.writeFile(manifestPath, JSON.stringify(validated, null, 2), 'utf-8');
    
    logger.debug('Wrote manifest', { runId: this.runId, manifestPath });
  }
  
  /**
   * Write log file
   */
  async writeLog(type: 'stdout' | 'stderr', content: string): Promise<void> {
    const logPath = join(this.runDir, 'logs', `${type}.txt`);
    await fs.writeFile(logPath, content, 'utf-8');
    
    // Update manifest
    if (!this.manifest.logs) {
      this.manifest.logs = {};
    }
    this.manifest.logs[type] = `logs/${type}.txt`;
    await this.writeManifest();
  }
  
  /**
   * Mark run as completed successfully
   */
  async markSuccess(): Promise<void> {
    this.manifest.status = 'completed';
    this.manifest.completed_at = new Date().toISOString();
    
    // Calculate total timing if individual phases exist
    if (this.manifest.timing) {
      const { plan_ms = 0, coverage_ms = 0, slice_ms = 0, execution_ms = 0, optimization_ms = 0 } = this.manifest.timing;
      this.manifest.timing.total_ms = plan_ms + coverage_ms + slice_ms + execution_ms + optimization_ms;
    }
    
    await this.writeManifest();
    
    // Write _SUCCESS marker
    if (this.config.writeSuccessMarker) {
      const successPath = join(this.runDir, '_SUCCESS');
      await fs.writeFile(successPath, new Date().toISOString(), 'utf-8');
      logger.info('Marked run as successful', { runId: this.runId, successPath });
    }
  }
  
  /**
   * Mark run as failed
   */
  async markFailure(error: Error): Promise<void> {
    this.manifest.status = 'failed';
    this.manifest.completed_at = new Date().toISOString();
    
    await this.writeManifest();
    
    // Write error to logs
    await this.writeLog('stderr', error.stack || error.message);
    
    logger.error('Marked run as failed', {
      runId: this.runId,
      error: error.message,
    });
  }
  
  /**
   * Read manifest from disk
   */
  static async readManifest(runDir: string): Promise<RunManifest> {
    const manifestPath = join(runDir, 'run.json');
    const content = await fs.readFile(manifestPath, 'utf-8');
    return RunManifestSchema.parse(JSON.parse(content));
  }
  
  /**
   * Check if run is complete (has _SUCCESS marker)
   */
  static async isComplete(runDir: string): Promise<boolean> {
    try {
      const successPath = join(runDir, '_SUCCESS');
      await fs.access(successPath);
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create a new run directory
 */
export async function createRunDirectory(
  runId: string,
  runType: RunManifest['run_type'],
  config?: ArtifactWriterConfig
): Promise<RunDirectory> {
  const runDir = new RunDirectory(runId, runType, config);
  await runDir.initialize();
  return runDir;
}

/**
 * List all run directories (optionally filter by completion status)
 */
export async function listRunDirectories(
  baseDir: string = 'runs',
  onlyComplete: boolean = false
): Promise<string[]> {
  const runs: string[] = [];
  
  try {
    // Check if base directory exists
    await fs.access(baseDir);
  } catch {
    return runs;
  }
  
  // Scan for month partitions
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const monthDir = join(baseDir, entry.name);
    
    // Check if this is a month partition (YYYY-MM) or direct run directory
    if (/^\d{4}-\d{2}$/.test(entry.name)) {
      // Month partition - scan for run directories
      const runEntries = await fs.readdir(monthDir, { withFileTypes: true });
      for (const runEntry of runEntries) {
        if (!runEntry.isDirectory()) continue;
        if (!runEntry.name.startsWith('run_id=')) continue;
        
        const runDir = join(monthDir, runEntry.name);
        
        if (onlyComplete) {
          const isComplete = await RunDirectory.isComplete(runDir);
          if (isComplete) {
            runs.push(runDir);
          }
        } else {
          runs.push(runDir);
        }
      }
    } else if (entry.name.startsWith('run_id=')) {
      // Direct run directory (no month partition)
      const runDir = join(baseDir, entry.name);
      
      if (onlyComplete) {
        const isComplete = await RunDirectory.isComplete(runDir);
        if (isComplete) {
          runs.push(runDir);
        }
      } else {
        runs.push(runDir);
      }
    }
  }
  
  return runs;
}

/**
 * Get git provenance information
 */
export async function getGitProvenance(): Promise<{
  commit?: string;
  branch?: string;
  dirty?: boolean;
}> {
  try {
    const { execSync } = await import('child_process');
    
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    const dirty = status.length > 0;
    
    return { commit, branch, dirty };
  } catch {
    return {};
  }
}

