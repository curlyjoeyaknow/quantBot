/**
 * Handler for validating Python simulation setup
 */

import type { CommandContext } from '../../core/command-context.js';
import { PythonSimulationService } from '@quantbot/backtest';

export async function validateSimulationHandler(
  _args: Record<string, unknown>,
  ctx: CommandContext
): Promise<{
  valid: boolean;
  pythonVersion?: string;
  modulePath?: string;
  error?: string;
}> {
  const pythonEngine = ctx.services.pythonEngine();
  const service = new PythonSimulationService(pythonEngine);
  return await service.validateSetup();
}
