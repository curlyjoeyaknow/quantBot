/**
 * Evaluate Calls Handler
 *
 * Thin adapter that loads CallSignal[] and calls evaluateCallsWorkflow
 */

import { readFileSync } from 'fs';
import { DateTime } from 'luxon';
import { ValidationError, ConfigurationError } from '@quantbot/utils';
import type { CommandContext } from '../../core/command-context.js';
import { evaluateCallsWorkflow, createProductionContextWithPorts } from '@quantbot/workflows';
import type { EvaluateCallsRequest } from '@quantbot/workflows';
import type { CallSignal } from '@quantbot/core';
import type { EvaluateCallsArgs } from '../../command-defs/calls.js';

export async function evaluateCallsHandler(_args: EvaluateCallsArgs, _ctx: CommandContext) {
  // Load CallSignal[] from JSON file
  let calls: CallSignal[];
  try {
    const fileContent = readFileSync(_args.callsFile, 'utf-8');
    const parsed = JSON.parse(fileContent);

    // Validate it's an array
    if (!Array.isArray(parsed)) {
      throw new ValidationError('Calls file must contain a JSON array of CallSignal objects', {
        callsFile: _args.callsFile,
      });
    }

    calls = parsed as CallSignal[];
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ConfigurationError(`Failed to load calls from ${_args.callsFile}`, 'callsFile', {
      callsFile: _args.callsFile,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Build workflow request
  const request: EvaluateCallsRequest = {
    calls,
    align: {
      lagMs: _args.lagMs,
      entryRule: _args.entryRule,
      timeframeMs: _args.timeframeMs,
      interval: _args.interval,
    },
    backtest: {
      fee: {
        takerFeeBps: _args.takerFeeBps,
        slippageBps: _args.slippageBps,
      },
      overlays: _args.overlays,
      position: {
        notionalUsd: _args.notionalUsd,
      },
    },
  };

  // Create production context with ports
  const ctx = await createProductionContextWithPorts();

  // Run workflow
  return await evaluateCallsWorkflow(request, ctx);
}
