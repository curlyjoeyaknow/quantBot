/**
 * PythonEngine - Abstraction for executing Python scripts from TypeScript
 *
 * Handles subprocess execution, JSON input/output, schema validation, and error handling.
 * This is the boundary layer between TypeScript handlers and Python tools.
 */

import { execSync, spawn } from 'child_process';
import { join } from 'path';
import { z } from 'zod';
import { existsSync, statSync } from 'fs';
import { execa } from 'execa';
import { logger, ValidationError, TimeoutError, AppError } from '../index.js';

export interface PythonScriptOptions {
  /**
   * Timeout in milliseconds (default: 5 minutes)
   */
  timeout?: number;
  /**
   * Working directory for the Python script
   */
  cwd?: string;
  /**
   * Environment variables to pass to the subprocess
   */
  env?: Record<string, string>;
  /**
   * Whether to expect JSON output on stdout (default: true)
   */
  expectJsonOutput?: boolean;
}

export interface TelegramPipelineConfig {
  inputFile: string;
  outputDb: string;
  chatId: string;
  rebuild?: boolean;
}

export interface DuckDBStorageConfig {
  duckdbPath: string;
  operation: 'store_strategy' | 'store_run' | 'store_alerts' | 'generate_report';
  data: Record<string, unknown>;
}

export interface ClickHouseEngineConfig {
  operation: 'query_ohlcv' | 'store_events' | 'aggregate_metrics';
  data: Record<string, unknown>;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
}

/**
 * Schema for Python tool output (manifest)
 */
export const PythonManifestSchema = z.object({
  chat_id: z.string(),
  chat_name: z.string(),
  duckdb_file: z.string(),
  tg_rows: z.number().optional(),
  caller_links_rows: z.number().optional(),
  user_calls_rows: z.number().optional(),
});

export type PythonManifest = z.infer<typeof PythonManifestSchema>;

/**
 * Options for artifact verification
 */
export interface ArtifactVerificationOptions {
  /**
   * Whether to verify artifacts exist on filesystem
   */
  verifyArtifacts?: boolean;
  /**
   * Paths to artifact fields in the result object (e.g., ['duckdb_file', 'artifacts'])
   */
  artifactFields?: string[];
}

/**
 * PythonEngine - Executes Python scripts and validates output
 */
export class PythonEngine {
  private readonly defaultTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly pythonCommand: string;

  constructor(pythonCommand: string = 'python3') {
    this.pythonCommand = pythonCommand;
  }

  /**
   * Verify that artifact files exist on the filesystem
   *
   * @param result - The result object from Python script
   * @param artifactFields - Fields in result that contain file paths
   * @throws ValidationError if any artifacts are missing
   */
  private verifyArtifacts(result: any, artifactFields: string[]): void {
    const missingArtifacts: string[] = [];

    for (const field of artifactFields) {
      const value = result[field];
      if (!value) continue;

      if (typeof value === 'string') {
        // Single file path
        if (!existsSync(value)) {
          missingArtifacts.push(value);
        }
      } else if (Array.isArray(value)) {
        // Array of file paths
        for (const path of value) {
          if (typeof path === 'string' && !existsSync(path)) {
            missingArtifacts.push(path);
          }
        }
      } else if (typeof value === 'object') {
        // Nested object - recursively check
        this.verifyArtifacts(value, Object.keys(value));
      }
    }

    if (missingArtifacts.length > 0) {
      throw new ValidationError(
        `Python script claimed artifacts that do not exist: ${missingArtifacts.join(', ')}`,
        {
          missingArtifacts,
          result,
        }
      );
    }
  }

  /**
   * Run a Python script with arguments and validate output
   *
   * @param scriptPath - Path to Python script
   * @param args - Arguments as key-value pairs (will be converted to --key value format)
   * @param schema - Zod schema to validate output against
   * @param options - Execution options
   * @returns Validated output parsed from JSON
   */
  async runScript<T>(
    scriptPath: string,
    args: Record<string, unknown>,
    schema: z.ZodSchema<T>,
    options?: PythonScriptOptions
  ): Promise<T> {
    return this.runScriptWithArtifacts(scriptPath, args, schema, options, {
      verifyArtifacts: false,
    });
  }

  /**
   * Run a Python script with artifact verification
   *
   * @param scriptPath - Path to Python script
   * @param args - Arguments as key-value pairs
   * @param schema - Zod schema to validate output against
   * @param options - Execution options
   * @param artifactOptions - Artifact verification options
   * @returns Validated output with verified artifacts
   */
  async runScriptWithArtifacts<T>(
    scriptPath: string,
    args: Record<string, unknown>,
    schema: z.ZodSchema<T>,
    options?: PythonScriptOptions,
    artifactOptions?: ArtifactVerificationOptions
  ): Promise<T> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const expectJson = options?.expectJsonOutput ?? true;

    // Build command arguments
    const argList: string[] = [scriptPath];
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) {
        continue;
      }
      const argName = key.length === 1 ? `-${key}` : `--${key.replace(/_/g, '-')}`;
      if (typeof value === 'boolean') {
        if (value) {
          argList.push(argName);
        }
      } else {
        argList.push(argName, String(value));
      }
    }

    const command = `${this.pythonCommand} ${argList.join(' ')}`;
    logger.debug('Executing Python script', { command, cwd: options?.cwd });

    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout,
      });

      if (!expectJson) {
        return output as unknown as T;
      }

      // Handle both string and Buffer outputs (for compatibility with mocks)
      // Note: execSync with encoding: 'utf-8' should return string, but mocks may return Buffer
      const outputString = typeof output === 'string' ? output : (output as Buffer).toString('utf-8');

      // Parse JSON from last line (Python tools typically output JSON on last line)
      const lines = outputString.trim().split('\n');
      const jsonLine = lines[lines.length - 1];

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonLine);
      } catch (error) {
        // Try parsing entire output if last line isn't JSON
        try {
          parsed = JSON.parse(outputString.trim());
        } catch {
          throw new ValidationError(
            `Failed to parse JSON output from Python script. Last line: ${jsonLine.substring(0, 200)}`,
            { script: scriptPath, lastLine: jsonLine.substring(0, 200) }
          );
        }
      }

      // Validate against schema
      let validated: T;
      try {
        validated = schema.parse(parsed);
      } catch (zodError: any) {
        // Enhance Zod validation errors with script context
        throw new ValidationError(
          `Python script output failed schema validation: ${zodError.message}`,
          {
            script: scriptPath,
            zodError: zodError.issues || zodError.errors || zodError.message,
            receivedData: parsed,
          }
        );
      }

      // Verify artifacts if requested
      if (artifactOptions?.verifyArtifacts && artifactOptions.artifactFields) {
        this.verifyArtifacts(validated, artifactOptions.artifactFields);
      }

      return validated;
    } catch (error: any) {
      // Handle subprocess errors
      if (error.signal === 'SIGTERM' || error.status === 124) {
        throw new TimeoutError(`Python script timed out after ${timeout}ms`, timeout, {
          script: scriptPath,
        });
      }
      if (error.status !== undefined && error.status !== 0) {
        const stderr = error.stderr?.toString() || '';
        const stdout = error.stdout?.toString() || '';
        throw new AppError(
          `Python script exited with code ${error.status}: ${stderr || error.message || 'Unknown error'}`,
          'PYTHON_SCRIPT_ERROR',
          500,
          {
            script: scriptPath,
            exitCode: error.status,
            stderr: stderr.substring(0, 1000), // Truncate to prevent huge error messages
            stdout: stdout.substring(0, 500), // Include some stdout for context
          }
        );
      }
      // Re-throw if already a custom error (ValidationError, etc.)
      throw error;
    }
  }

  /**
   * Run Telegram DuckDB pipeline
   *
   * @param config - Pipeline configuration
   * @param options - Execution options
   * @returns Validated manifest
   */
  async runTelegramPipeline(
    config: TelegramPipelineConfig,
    options?: PythonScriptOptions
  ): Promise<PythonManifest> {
    const scriptPath = join(process.cwd(), 'tools/telegram/duckdb_punch_pipeline.py');

    const args: Record<string, unknown> = {
      in: config.inputFile,
      duckdb: config.outputDb,
      'chat-id': config.chatId,
    };

    if (config.rebuild) {
      args.rebuild = true;
    }

    const cwd = options?.cwd ?? join(process.cwd(), 'tools/telegram');
    const env = {
      ...options?.env,
      PYTHONPATH: join(process.cwd(), 'tools/telegram'),
    };

    return this.runScript(scriptPath, args, PythonManifestSchema, {
      ...options,
      cwd,
      env,
    });
  }

  /**
   * Run DuckDB storage operation
   *
   * @param config - Storage configuration
   * @param options - Execution options
   * @returns Operation result
   */
  async runDuckDBStorage(
    config: DuckDBStorageConfig,
    options?: PythonScriptOptions
  ): Promise<Record<string, unknown>> {
    const scriptPath = join(process.cwd(), 'tools/simulation/duckdb_storage.py');

    const args: Record<string, unknown> = {
      duckdb: config.duckdbPath,
      operation: config.operation,
      data: JSON.stringify(config.data),
    };

    const cwd = options?.cwd ?? join(process.cwd(), 'tools/simulation');
    const env = {
      ...options?.env,
      PYTHONPATH: join(process.cwd(), 'tools/simulation'),
    };

    const resultSchema = z
      .object({
        success: z.boolean(),
        error: z.string().optional(),
      })
      .passthrough();

    return this.runScript(scriptPath, args, resultSchema, {
      ...options,
      cwd,
      env,
    });
  }

  /**
   * Run ClickHouse engine operation
   *
   * @param config - Engine configuration
   * @param options - Execution options
   * @returns Operation result
   */
  async runClickHouseEngine(
    config: ClickHouseEngineConfig,
    options?: PythonScriptOptions
  ): Promise<Record<string, unknown>> {
    const scriptPath = join(process.cwd(), 'tools/simulation/clickhouse_engine.py');

    const args: Record<string, unknown> = {
      operation: config.operation,
      data: JSON.stringify(config.data),
    };

    if (config.host) args.host = config.host;
    if (config.port) args.port = config.port;
    if (config.database) args.database = config.database;
    if (config.username) args.username = config.username;
    if (config.password) args.password = config.password;

    const cwd = options?.cwd ?? join(process.cwd(), 'tools/simulation');
    const env = {
      ...options?.env,
      PYTHONPATH: join(process.cwd(), 'tools/simulation'),
    };

    const resultSchema = z
      .object({
        success: z.boolean(),
        error: z.string().optional(),
      })
      .passthrough();

    return this.runScript(scriptPath, args, resultSchema, {
      ...options,
      cwd,
      env,
    });
  }

  /**
   * Run a Python script with stdin input
   *
   * @param scriptPath - Path to Python script
   * @param stdinInput - Input to pass via stdin (will be JSON stringified if object)
   * @param schema - Zod schema to validate output against
   * @param options - Execution options
   * @returns Validated output parsed from JSON
   */
  async runScriptWithStdin<T>(
    scriptPath: string,
    stdinInput: string | Record<string, unknown>,
    schema: z.ZodSchema<T>,
    options?: PythonScriptOptions
  ): Promise<T> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const inputString = typeof stdinInput === 'string' ? stdinInput : JSON.stringify(stdinInput);
    const scriptFullPath = join(process.cwd(), scriptPath);

    logger.debug('Executing Python script with stdin', {
      script: scriptFullPath,
      cwd: options?.cwd,
      inputLength: inputString.length,
    });

    try {
      const { stdout, stderr } = await execa(this.pythonCommand, [scriptFullPath], {
        input: inputString,
        encoding: 'utf8',
        timeout,
        cwd: options?.cwd ?? process.cwd(),
        env: { ...process.env, ...options?.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stderr) {
        logger.warn('Python script stderr', { script: scriptFullPath, stderr });
      }

      // Parse JSON from stdout
      let parsed: unknown;
      try {
        // Try parsing entire output first
        parsed = JSON.parse(stdout.trim());
      } catch {
        // Try parsing last line if entire output isn't JSON
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        try {
          parsed = JSON.parse(jsonLine);
        } catch {
          throw new ValidationError(
            `Failed to parse JSON output from Python script. Output: ${stdout.substring(0, 500)}`,
            { script: scriptFullPath, output: stdout.substring(0, 500) }
          );
        }
      }

      // Validate against schema
      let validated: T;
      try {
        validated = schema.parse(parsed);
      } catch (zodError: any) {
        throw new ValidationError(
          `Python script output failed schema validation: ${zodError.message}`,
          {
            script: scriptFullPath,
            zodError: zodError.issues || zodError.errors || zodError.message,
            receivedData: parsed,
          }
        );
      }

      return validated;
    } catch (error: any) {
      // Handle timeout errors
      if (error.timedOut || error.signal === 'SIGTERM') {
        throw new TimeoutError(`Python script timed out after ${timeout}ms`, timeout, {
          script: scriptFullPath,
        });
      }

      // Handle execa errors
      if (error.exitCode !== undefined && error.exitCode !== 0) {
        const stderr = error.stderr || '';
        const stdout = error.stdout || '';
        throw new AppError(
          `Python script exited with code ${error.exitCode}: ${stderr || error.message || 'Unknown error'}`,
          'PYTHON_SCRIPT_ERROR',
          500,
          {
            script: scriptFullPath,
            exitCode: error.exitCode,
            stderr: stderr.substring(0, 1000),
            stdout: stdout.substring(0, 500),
          }
        );
      }

      // Re-throw if already a custom error
      if (
        error instanceof AppError ||
        error instanceof ValidationError ||
        error instanceof TimeoutError
      ) {
        throw error;
      }

      // Wrap unknown errors
      throw new AppError(
        `Failed to execute Python script: ${error.message || String(error)}`,
        'PYTHON_SCRIPT_ERROR',
        500,
        { script: scriptFullPath }
      );
    }
  }
}

/**
 * Get default PythonEngine instance (singleton pattern)
 */
let defaultEngine: PythonEngine | null = null;

export function getPythonEngine(): PythonEngine {
  if (!defaultEngine) {
    defaultEngine = new PythonEngine();
  }
  return defaultEngine;
}
