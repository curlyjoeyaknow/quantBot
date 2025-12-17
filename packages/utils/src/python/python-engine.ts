/**
 * PythonEngine - Abstraction for executing Python scripts from TypeScript
 *
 * Handles subprocess execution, JSON input/output, schema validation, and error handling.
 * This is the boundary layer between TypeScript handlers and Python tools.
 */

import { execSync, spawn } from 'child_process';
import { join } from 'path';
import { z } from 'zod';
import { logger } from '../logger.js';

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
 * PythonEngine - Executes Python scripts and validates output
 */
export class PythonEngine {
  private readonly defaultTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly pythonCommand: string;

  constructor(pythonCommand: string = 'python3') {
    this.pythonCommand = pythonCommand;
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

      // Parse JSON from last line (Python tools typically output JSON on last line)
      const lines = output.trim().split('\n');
      const jsonLine = lines[lines.length - 1];

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonLine);
      } catch (error) {
        // Try parsing entire output if last line isn't JSON
        try {
          parsed = JSON.parse(output.trim());
        } catch {
          throw new Error(
            `Failed to parse JSON output from Python script. Last line: ${jsonLine.substring(0, 200)}`
          );
        }
      }

      // Validate against schema
      const validated = schema.parse(parsed);
      return validated;
    } catch (error: any) {
      if (error.signal === 'SIGTERM' || error.status === 124) {
        throw new Error(`Python script timed out after ${timeout}ms`);
      }
      if (error.status !== undefined && error.status !== 0) {
        throw new Error(
          `Python script exited with code ${error.status}: ${error.message || error.stderr?.toString() || 'Unknown error'}`
        );
      }
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
    const scriptPath = join(
      process.cwd(),
      'tools/telegram/duckdb_punch_pipeline.py'
    );

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

    return this.runScript(
      scriptPath,
      args,
      PythonManifestSchema,
      {
        ...options,
        cwd,
        env,
      }
    );
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

