/**
 * PythonEngine - Abstraction for executing Python scripts from TypeScript
 *
 * Handles subprocess execution, JSON input/output, schema validation, and error handling.
 * This is the boundary layer between TypeScript handlers and Python tools.
 */

import { execSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { execa } from 'execa';
import { logger, ValidationError, TimeoutError, AppError } from '../index.js';

/**
 * Find workspace root by walking up from current directory
 * looking for pnpm-workspace.yaml or package.json with workspace config
 */
function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let current = startDir;

  while (current !== '/' && current !== '') {
    const workspaceFile = join(current, 'pnpm-workspace.yaml');
    const packageFile = join(current, 'package.json');

    if (existsSync(workspaceFile)) {
      return current;
    }

    if (existsSync(packageFile)) {
      try {
        const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
        if (pkg.workspaces || pkg.pnpm?.workspace) {
          return current;
        }
      } catch {
        // Continue searching
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root
      break;
    }
    current = parent;
  }

  // Fallback to start directory if workspace root not found
  return startDir;
}

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
  chatId?: string; // Optional - Python script will extract from file or default to "single_chat"
  rebuild?: boolean;
}

export interface DuckDBStorageConfig {
  duckdbPath: string;
  operation:
    | 'store_strategy'
    | 'store_run'
    | 'store_alerts'
    | 'generate_report'
    | 'query_calls'
    | 'update_ohlcv_metadata'
    | 'query_ohlcv_metadata'
    | 'add_ohlcv_exclusion'
    | 'query_ohlcv_exclusions'
    | 'get_state'
    | 'set_state'
    | 'delete_state'
    | 'init_state_table';
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

export interface OhlcvWorklistConfig {
  duckdbPath: string;
  from?: string;
  to?: string;
  side?: 'buy' | 'sell';
  mints?: string[]; // Optional: filter by specific mint addresses
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
  private verifyArtifacts(result: Record<string, unknown>, artifactFields: string[]): void {
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
      } else if (typeof value === 'object' && value !== null) {
        // Nested object - recursively check
        this.verifyArtifacts(value as Record<string, unknown>, Object.keys(value));
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

    logger.debug('Executing Python script', {
      script: scriptPath,
      args: argList,
      cwd: options?.cwd,
    });

    try {
      // Use execa instead of execSync for more reliable argument handling
      // execa passes arguments directly without shell interpretation, avoiding escaping issues
      const result = await execa(this.pythonCommand, argList, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout,
        encoding: 'utf8', // Ensure stdout/stderr are strings (for error handling)
      });

      const output = result.stdout;

      if (!expectJson) {
        return output as unknown as T;
      }

      // Handle both string and Buffer outputs (for compatibility with mocks)
      // Note: execSync with encoding: 'utf-8' should return string, but mocks may return Buffer
      const outputString =
        typeof output === 'string' ? output : (output as Buffer).toString('utf-8');

      // Parse JSON from last line (Python tools typically output JSON on last line)
      // But also check if entire output is JSON, or if JSON appears anywhere in output
      const lines = outputString.trim().split('\n');
      const jsonLine = lines[lines.length - 1];

      let parsed: unknown;
      let parseError: Error | undefined;

      // Try parsing last line first (most common case)
      try {
        parsed = JSON.parse(jsonLine);
      } catch (error) {
        parseError = error instanceof Error ? error : new Error(String(error));

        // Try parsing entire output (some scripts output only JSON)
        try {
          parsed = JSON.parse(outputString.trim());
        } catch {
          // Try to find JSON in any line (look for lines starting with { or [)
          let foundJson = false;
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (
              (line.startsWith('{') || line.startsWith('[')) &&
              (line.endsWith('}') || line.endsWith(']'))
            ) {
              try {
                parsed = JSON.parse(line);
                foundJson = true;
                break;
              } catch {
                // Continue searching
              }
            }
          }

          if (!foundJson) {
            // Provide detailed error information
            const lastFewLines = lines.slice(-5).join('\n');
            const errorDetails = {
              script: scriptPath,
              lastLine: jsonLine.substring(0, 200),
              lastFewLines: lastFewLines.substring(0, 500),
              outputLength: outputString.length,
              parseError: parseError.message,
            };
            throw new ValidationError(
              `Failed to parse JSON output from Python script. Last line: ${jsonLine.substring(0, 100)}${jsonLine.length > 100 ? '...' : ''}. Parse error: ${parseError.message}`,
              errorDetails
            );
          }
        }
      }

      // Validate against schema
      let validated: T;
      try {
        validated = schema.parse(parsed);
      } catch (zodError: unknown) {
        // Enhance Zod validation errors with script context
        const errorMessage =
          zodError instanceof Error
            ? zodError.message
            : typeof zodError === 'object' && zodError !== null && 'message' in zodError
              ? String((zodError as { message: unknown }).message)
              : String(zodError);
        const zodIssues =
          typeof zodError === 'object' &&
          zodError !== null &&
          ('issues' in zodError || 'errors' in zodError)
            ? (zodError as { issues?: unknown; errors?: unknown }).issues ||
              (zodError as { issues?: unknown; errors?: unknown }).errors
            : undefined;
        throw new ValidationError(
          `Python script output failed schema validation: ${errorMessage}`,
          {
            script: scriptPath,
            zodError: zodIssues || errorMessage,
            receivedData: parsed,
          }
        );
      }

      // Verify artifacts if requested
      if (artifactOptions?.verifyArtifacts && artifactOptions.artifactFields) {
        this.verifyArtifacts(validated as Record<string, unknown>, artifactOptions.artifactFields);
      }

      return validated;
    } catch (error: unknown) {
      // Re-throw if already a custom error (ValidationError, AppError, TimeoutError, etc.)
      if (
        error instanceof AppError ||
        error instanceof ValidationError ||
        error instanceof TimeoutError
      ) {
        throw error;
      }

      // Handle execa/subprocess errors
      // execa v9 throws errors with exitCode, stderr, stdout properties
      // Check if it's an execa error by looking for exitCode, status, or execa-specific properties
      const errorObj = error as {
        signal?: string;
        exitCode?: number;
        status?: number; // Legacy execa compatibility
        stderr?: string | Buffer | { toString(): string };
        stdout?: string | Buffer | { toString(): string };
        message?: string;
        timedOut?: boolean;
        shortMessage?: string;
        command?: string;
        isMaxBuffer?: boolean;
        failed?: boolean;
        isCanceled?: boolean;
        isGracefullyCanceled?: boolean;
        isTerminated?: boolean;
        isForcefullyTerminated?: boolean;
      };

      // Check if this looks like an execa error (has execa-specific properties)
      // execa v9 errors have: exitCode, failed, command, stderr, stdout, etc.
      const isExecaError =
        errorObj.exitCode !== undefined ||
        errorObj.status !== undefined ||
        errorObj.failed === true ||
        errorObj.command !== undefined ||
        (error instanceof Error &&
          (error.constructor.name === 'ExecaError' || error.constructor.name.includes('Execa')));

      // Check for maxBuffer exceeded error (execa throws this before process exits)
      const errorMessage =
        errorObj.message ||
        errorObj.shortMessage ||
        (error instanceof Error ? error.message : String(error));
      if (
        errorObj.isMaxBuffer ||
        (errorMessage && /maxBuffer|stdout.*exceeded|buffer.*exceeded/i.test(errorMessage))
      ) {
        throw new AppError(
          `Python script output exceeded maxBuffer limit (10MB). Output was truncated.`,
          'PYTHON_SCRIPT_ERROR',
          500,
          {
            script: scriptPath,
            errorType: 'maxBufferExceeded',
            maxBuffer: '10MB',
          }
        );
      }

      // Check for timeout errors
      if (
        errorObj.timedOut ||
        errorObj.signal === 'SIGTERM' ||
        errorObj.exitCode === 124 ||
        errorObj.status === 124
      ) {
        throw new TimeoutError(`Python script timed out after ${timeout}ms`, timeout, {
          script: scriptPath,
        });
      }

      // Check for non-zero exit code (this is the main path for execa errors)
      // execa errors have exitCode property, or status for legacy compatibility
      // Also check if error has 'failed' property (execa sets this)
      const exitCode = errorObj.exitCode ?? errorObj.status;
      const isFailed = errorObj.failed ?? false;

      // Catch execa errors: either has exitCode/status, failed=true, or matches execa error pattern
      if (isExecaError || isFailed || (exitCode !== undefined && exitCode !== 0)) {
        // Handle stderr/stdout as string, Buffer, or object with toString()
        const stderr = errorObj.stderr
          ? typeof errorObj.stderr === 'string'
            ? errorObj.stderr
            : errorObj.stderr instanceof Buffer
              ? errorObj.stderr.toString('utf-8')
              : typeof errorObj.stderr.toString === 'function'
                ? errorObj.stderr.toString()
                : String(errorObj.stderr)
          : '';
        const stdout = errorObj.stdout
          ? typeof errorObj.stdout === 'string'
            ? errorObj.stdout
            : errorObj.stdout instanceof Buffer
              ? errorObj.stdout.toString('utf-8')
              : typeof errorObj.stdout.toString === 'function'
                ? errorObj.stdout.toString()
                : String(errorObj.stdout)
          : '';

        // Build error message with context
        const stderrMessage = stderr || errorObj.message || errorMessage || 'Unknown error';
        const finalExitCode = exitCode ?? (isFailed ? 1 : undefined);
        throw new AppError(
          `Python script exited with code ${finalExitCode ?? 'unknown'}: ${stderrMessage}`,
          'PYTHON_SCRIPT_ERROR',
          500,
          {
            script: scriptPath,
            exitCode: finalExitCode,
            stderr: stderr.substring(0, 1000), // Truncate to prevent huge error messages
            stdout: stdout.substring(0, 500), // Include some stdout for context
            command: errorObj.command, // Include command for debugging
          }
        );
      }

      // For unknown errors, wrap them in AppError
      const unknownErrorMessage = error instanceof Error ? error.message : String(error);
      throw new AppError(
        `Failed to execute Python script: ${unknownErrorMessage}`,
        'PYTHON_SCRIPT_ERROR',
        500,
        {
          script: scriptPath,
          originalError: unknownErrorMessage,
        }
      );
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
    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'tools/telegram/duckdb_punch_pipeline.py');

    // Resolve paths to absolute paths to avoid issues with working directory
    const inputFile = config.inputFile.startsWith('/')
      ? config.inputFile
      : join(workspaceRoot, config.inputFile);
    const outputDb = config.outputDb.startsWith('/')
      ? config.outputDb
      : join(workspaceRoot, config.outputDb);

    const args: Record<string, unknown> = {
      in: inputFile,
      duckdb: outputDb,
    };

    // Only pass chat-id if provided (Python script will extract from file or default to "single_chat")
    if (config.chatId) {
      args['chat-id'] = config.chatId;
    }

    if (config.rebuild) {
      args.rebuild = true;
    }

    const cwd = options?.cwd ?? join(workspaceRoot, 'tools/telegram');
    const env = {
      ...options?.env,
      PYTHONPATH: join(workspaceRoot, 'tools/telegram'),
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
    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'tools/simulation/duckdb_storage/main.py');

    const args: Record<string, unknown> = {
      duckdb: config.duckdbPath,
      operation: config.operation,
      data: JSON.stringify(config.data),
    };

    const cwd = options?.cwd ?? join(workspaceRoot, 'tools/simulation');
    const env = {
      ...options?.env,
      PYTHONPATH: join(workspaceRoot, 'tools/simulation'),
    };

    const resultSchema = z
      .object({
        success: z.boolean(),
        error: z.string().nullable().optional(),
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
    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'tools/simulation/clickhouse_engine.py');

    const args: Record<string, unknown> = {
      operation: config.operation,
      data: JSON.stringify(config.data),
    };

    if (config.host) args.host = config.host;
    if (config.port) args.port = config.port;
    if (config.database) args.database = config.database;
    if (config.username) args.username = config.username;
    if (config.password) args.password = config.password;

    const cwd = options?.cwd ?? join(workspaceRoot, 'tools/simulation');
    const env = {
      ...options?.env,
      PYTHONPATH: join(workspaceRoot, 'tools/simulation'),
    };

    const resultSchema = z
      .object({
        success: z.boolean(),
        error: z.string().nullable().optional(),
      })
      .passthrough();

    return this.runScript(scriptPath, args, resultSchema, {
      ...options,
      cwd,
      env,
    });
  }

  /**
   * Run OHLCV worklist query from DuckDB
   *
   * @param config - Worklist configuration
   * @param options - Execution options
   * @returns Worklist with token groups and individual calls
   */
  async runOhlcvWorklist(
    config: OhlcvWorklistConfig,
    options?: PythonScriptOptions
  ): Promise<{
    tokenGroups: Array<{
      mint: string;
      chain: string;
      earliestAlertTime: string | null;
      callCount: number;
    }>;
    calls: Array<{
      mint: string;
      chain: string;
      alertTime: string | null;
      chatId: string | null;
      messageId: string | null;
      priceUsd: number | null;
      mcapUsd: number | null;
      botTsMs: number | null;
    }>;
  }> {
    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'tools/ingestion/ohlcv_worklist.py');

    // Resolve duckdbPath to absolute path (Python script runs from tools/ingestion directory)
    const absoluteDuckdbPath = resolve(config.duckdbPath);

    const args: Record<string, unknown> = {
      duckdb: absoluteDuckdbPath,
    };

    if (config.from) {
      args.from = config.from;
    }
    if (config.to) {
      args.to = config.to;
    }
    if (config.side) {
      args.side = config.side;
    }
    if (config.mints && config.mints.length > 0) {
      args.mints = config.mints;
    }

    const cwd = options?.cwd ?? join(workspaceRoot, 'tools/ingestion');
    const env = {
      ...options?.env,
      PYTHONPATH: join(workspaceRoot, 'tools/ingestion'),
    };

    const tokenGroupSchema = z.object({
      mint: z.string(),
      chain: z.string(),
      earliestAlertTime: z.string().nullable(),
      callCount: z.number(),
    });

    const callSchema = z.object({
      mint: z.string(),
      chain: z.string(),
      alertTime: z.string().nullable(),
      chatId: z.string().nullable(),
      messageId: z.string().nullable(),
      priceUsd: z.number().nullable(),
      mcapUsd: z.number().nullable(),
      botTsMs: z.number().nullable(),
    });

    const resultSchema = z
      .object({
        tokenGroups: z.array(tokenGroupSchema),
        calls: z.array(callSchema),
      })
      .or(
        z.object({
          error: z.string(),
          tokenGroups: z.array(tokenGroupSchema),
          calls: z.array(callSchema),
        })
      );

    const result = await this.runScript(scriptPath, args, resultSchema, {
      ...options,
      cwd,
      env,
    });

    // Handle error response
    if (typeof result === 'object' && result !== null && 'error' in result) {
      throw new AppError(
        `OHLCV worklist query failed: ${(result as { error: string }).error}`,
        'OHLCV_WORKLIST_ERROR',
        500,
        { config }
      );
    }

    return result as {
      tokenGroups: Array<{
        mint: string;
        chain: string;
        earliestAlertTime: string | null;
        callCount: number;
      }>;
      calls: Array<{
        mint: string;
        chain: string;
        alertTime: string | null;
        chatId: string | null;
        messageId: string | null;
        priceUsd: number | null;
        mcapUsd: number | null;
        botTsMs: number | null;
      }>;
    };
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
    // Resolve script path: if absolute, use as-is; if relative, resolve from workspace root
    const scriptFullPath =
      scriptPath.startsWith('/') || scriptPath.match(/^[A-Z]:/)
        ? scriptPath
        : join(findWorkspaceRoot(), scriptPath);

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
      // Try parsing entire output first, then last line, then search for JSON in any line
      const lines = stdout.trim().split('\n');
      const jsonLine = lines[lines.length - 1];

      let parsed: unknown;
      let parseError: Error | undefined;

      try {
        // Try parsing entire output first
        parsed = JSON.parse(stdout.trim());
      } catch (error) {
        parseError = error instanceof Error ? error : new Error(String(error));

        try {
          // Try parsing last line
          parsed = JSON.parse(jsonLine);
        } catch {
          // Try to find JSON in any line (look for lines starting with { or [)
          let foundJson = false;
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (
              (line.startsWith('{') || line.startsWith('[')) &&
              (line.endsWith('}') || line.endsWith(']'))
            ) {
              try {
                parsed = JSON.parse(line);
                foundJson = true;
                break;
              } catch {
                // Continue searching
              }
            }
          }

          if (!foundJson) {
            const lastFewLines = lines.slice(-5).join('\n');
            throw new ValidationError(
              `Failed to parse JSON output from Python script. Output: ${stdout.substring(0, 500)}${stdout.length > 500 ? '...' : ''}. Parse error: ${parseError.message}`,
              {
                script: scriptFullPath,
                output: stdout.substring(0, 500),
                lastFewLines: lastFewLines.substring(0, 500),
                parseError: parseError.message,
              }
            );
          }
        }
      }

      // Validate against schema
      let validated: T;
      try {
        validated = schema.parse(parsed);
      } catch (zodError: unknown) {
        const errorMessage =
          zodError instanceof Error
            ? zodError.message
            : typeof zodError === 'object' && zodError !== null && 'message' in zodError
              ? String((zodError as { message: unknown }).message)
              : String(zodError);
        const zodIssues =
          typeof zodError === 'object' &&
          zodError !== null &&
          ('issues' in zodError || 'errors' in zodError)
            ? (zodError as { issues?: unknown; errors?: unknown }).issues ||
              (zodError as { issues?: unknown; errors?: unknown }).errors
            : undefined;
        throw new ValidationError(
          `Python script output failed schema validation: ${errorMessage}`,
          {
            script: scriptFullPath,
            zodError: zodIssues || errorMessage,
            receivedData: parsed,
          }
        );
      }

      return validated;
    } catch (error: unknown) {
      // Re-throw if already a custom error
      if (
        error instanceof AppError ||
        error instanceof ValidationError ||
        error instanceof TimeoutError
      ) {
        throw error;
      }

      // Handle execa/subprocess errors
      const errorObj = error as {
        timedOut?: boolean;
        signal?: string;
        exitCode?: number;
        status?: number;
        stderr?: string | Buffer | { toString(): string };
        stdout?: string | Buffer | { toString(): string };
        message?: string;
        shortMessage?: string;
        command?: string;
      };

      // Check for timeout errors
      if (
        errorObj.timedOut ||
        errorObj.signal === 'SIGTERM' ||
        errorObj.exitCode === 124 ||
        errorObj.status === 124
      ) {
        throw new TimeoutError(`Python script timed out after ${timeout}ms`, timeout, {
          script: scriptFullPath,
        });
      }

      // Check for non-zero exit code
      const exitCode = errorObj.exitCode ?? errorObj.status;
      if (exitCode !== undefined && exitCode !== 0) {
        const stderr = errorObj.stderr
          ? typeof errorObj.stderr === 'string'
            ? errorObj.stderr
            : errorObj.stderr instanceof Buffer
              ? errorObj.stderr.toString('utf-8')
              : typeof errorObj.stderr.toString === 'function'
                ? errorObj.stderr.toString()
                : String(errorObj.stderr)
          : '';
        const stdout = errorObj.stdout
          ? typeof errorObj.stdout === 'string'
            ? errorObj.stdout
            : errorObj.stdout instanceof Buffer
              ? errorObj.stdout.toString('utf-8')
              : typeof errorObj.stdout.toString === 'function'
                ? errorObj.stdout.toString()
                : String(errorObj.stdout)
          : '';
        const errorMessage =
          errorObj.message ||
          errorObj.shortMessage ||
          (error instanceof Error ? error.message : String(error));
        throw new AppError(
          `Python script exited with code ${exitCode}: ${stderr || errorMessage || 'Unknown error'}`,
          'PYTHON_SCRIPT_ERROR',
          500,
          {
            script: scriptFullPath,
            exitCode,
            stderr: stderr.substring(0, 1000),
            stdout: stdout.substring(0, 500),
            command: errorObj.command,
          }
        );
      }

      // Wrap unknown errors
      const unknownErrorMessage = error instanceof Error ? error.message : String(error);
      throw new AppError(
        `Failed to execute Python script: ${unknownErrorMessage}`,
        'PYTHON_SCRIPT_ERROR',
        500,
        { script: scriptFullPath }
      );
    }
  }
}

/**
 * @deprecated Use CommandContext or createProductionContext factory instead.
 * This singleton is kept for backward compatibility but should not be used in new code.
 *
 * Use:
 * - CommandContext.services.pythonEngine() for CLI commands
 * - Pass PythonEngine to createProductionContext config for workflows
 */
let defaultEngine: PythonEngine | null = null;

/**
 * @deprecated Use CommandContext or createProductionContext factory instead.
 * Get default PythonEngine instance (singleton pattern - deprecated)
 */
export function getPythonEngine(): PythonEngine {
  if (!defaultEngine) {
    defaultEngine = new PythonEngine();
  }
  return defaultEngine;
}
