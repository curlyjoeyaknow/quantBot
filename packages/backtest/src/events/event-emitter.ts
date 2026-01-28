/**
 * Event Emitter - Emit events to event log via Python script
 *
 * Uses PythonEngine pattern to call tools/ledger/emit_event.py
 */

import { join } from 'path';
import { z } from 'zod';
import { PythonEngine, logger, findWorkspaceRoot } from '@quantbot/infra/utils';

const EventEmitResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

type EventEmitResult = z.infer<typeof EventEmitResultSchema>;

/**
 * EventEmitter - Emits events to the event log
 */
export class EventEmitter {
  private readonly pythonEngine: PythonEngine;

  constructor(pythonEngine?: PythonEngine) {
    this.pythonEngine = pythonEngine ?? new PythonEngine();
  }

  /**
   * Emit run.created event
   */
  async emitRunCreated(
    runId: string,
    runType: 'baseline' | 'grid_search' | 'random_search' | 'walk_forward' | 'path-only' | 'policy',
    config: Record<string, unknown>,
    dataFingerprint: string
  ): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const args: Record<string, unknown> = {
        'event-type': 'run.created',
        'run-id': runId,
        'run-type': runType,
        config: JSON.stringify(config),
        'data-fingerprint': dataFingerprint,
      };

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        args,
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit run.created event', {
          runId,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting run.created event', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - event emission failures shouldn't break backtests
    }
  }

  /**
   * Emit run.started event
   */
  async emitRunStarted(runId: string): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        {
          'event-type': 'run.started',
          'run-id': runId,
        },
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit run.started event', {
          runId,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting run.started event', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emit run.completed event
   */
  async emitRunCompleted(
    runId: string,
    summary: Record<string, unknown>,
    artifactPaths: Record<string, string>
  ): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        {
          'event-type': 'run.completed',
          'run-id': runId,
          summary: JSON.stringify(summary),
          'artifact-paths': JSON.stringify(artifactPaths),
        },
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit run.completed event', {
          runId,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting run.completed event', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emit phase.started event
   */
  async emitPhaseStarted(runId: string, phaseName: string, phaseOrder: number): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        {
          'event-type': 'phase.started',
          'run-id': runId,
          'phase-name': phaseName,
          'phase-order': phaseOrder,
        },
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit phase.started event', {
          runId,
          phaseName,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting phase.started event', {
        runId,
        phaseName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emit phase.completed event
   */
  async emitPhaseCompleted(
    runId: string,
    phaseName: string,
    durationMs: number,
    outputSummary: Record<string, unknown>
  ): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        {
          'event-type': 'phase.completed',
          'run-id': runId,
          'phase-name': phaseName,
          'duration-ms': durationMs,
          'output-summary': JSON.stringify(outputSummary),
        },
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit phase.completed event', {
          runId,
          phaseName,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting phase.completed event', {
        runId,
        phaseName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emit trial.recorded event
   */
  async emitTrialRecorded(
    runId: string,
    trialId: string,
    params: Record<string, unknown>,
    metrics: Record<string, unknown>
  ): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        {
          'event-type': 'trial.recorded',
          'run-id': runId,
          'trial-id': trialId,
          params: JSON.stringify(params),
          metrics: JSON.stringify(metrics),
        },
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit trial.recorded event', {
          runId,
          trialId,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting trial.recorded event', {
        runId,
        trialId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emit baseline.completed event
   */
  async emitBaselineCompleted(
    runId: string,
    alertsTotal: number,
    alertsOk: number,
    artifactPath: string
  ): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        {
          'event-type': 'baseline.completed',
          'run-id': runId,
          'alerts-total': alertsTotal,
          'alerts-ok': alertsOk,
          'artifact-path': artifactPath,
        },
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit baseline.completed event', {
          runId,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting baseline.completed event', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emit artifact.created event
   */
  async emitArtifactCreated(
    runId: string,
    artifactType: string,
    artifactPath: string,
    sizeBytes: number
  ): Promise<void> {
    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/ledger/emit_event.py');

      const result = await this.pythonEngine.runScript<EventEmitResult>(
        scriptPath,
        {
          'event-type': 'artifact.created',
          'run-id': runId,
          'artifact-type': artifactType,
          'artifact-path': artifactPath,
          'size-bytes': sizeBytes,
        },
        EventEmitResultSchema,
        {
          cwd: join(workspaceRoot, 'tools/ledger'),
        }
      );

      if (!result.success) {
        logger.warn('Failed to emit artifact.created event', {
          runId,
          artifactType,
          error: result.error,
        });
      }
    } catch (error) {
      logger.warn('Error emitting artifact.created event', {
        runId,
        artifactType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Singleton instance
let defaultEventEmitter: EventEmitter | null = null;

/**
 * Get default event emitter instance
 */
export function getEventEmitter(): EventEmitter {
  if (!defaultEventEmitter) {
    defaultEventEmitter = new EventEmitter();
  }
  return defaultEventEmitter;
}
