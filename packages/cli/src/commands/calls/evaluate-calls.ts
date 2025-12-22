/**
 * Evaluate Calls Handler
 *
 * Thin adapter that loads CallSignal[] and calls evaluateCallsWorkflow
 */

import { readFileSync } from 'fs';
import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { evaluateCallsWorkflow, createProductionContextWithPorts } from '@quantbot/workflows';
import type { EvaluateCallsRequest } from '@quantbot/workflows';
import type { CallSignal } from '@quantbot/core';
import type { EvaluateCallsArgs } from '../../command-defs/calls.js';

export async function evaluateCallsHandler(args: EvaluateCallsArgs, _ctx: CommandContext) {
  // Load CallSignal[] from JSON file
  let calls: CallSignal[];
  try {
    const fileContent = readFileSync(args.callsFile, 'utf-8');
    const parsed = JSON.parse(fileContent);
    
    // Validate it's an array
    if (!Array.isArray(parsed)) {
      throw new Error('Calls file must contain a JSON array of CallSignal objects');
    }
    
    calls = parsed as CallSignal[];
  } catch (error) {
    throw new Error(`Failed to load calls from ${args.callsFile}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Build workflow request
  const request: EvaluateCallsRequest = {
    calls,
    align: {
      lagMs: args.lagMs,
      entryRule: args.entryRule,
      timeframeMs: args.timeframeMs,
      interval: args.interval,
    },
    backtest: {
      fee: {
        takerFeeBps: args.takerFeeBps,
        slippageBps: args.slippageBps,
      },
      overlays: args.overlays,
      position: {
        notionalUsd: args.notionalUsd,
      },
    },
  };

  // Create production context with ports
  const ctx = await createProductionContextWithPorts();

  // Run workflow
  return await evaluateCallsWorkflow(request, ctx);
}

