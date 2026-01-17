/**
 * Handler for checking contract version information
 */

import type { CommandContext } from '../../core/command-context.js';
import { PythonSimulationService } from '@quantbot/backtest';

export async function checkVersionHandler(
  _args: Record<string, unknown>,
  ctx: CommandContext
): Promise<{
  currentVersion: string;
  supportedVersions: string[];
}> {
  const pythonEngine = ctx.services.pythonEngine();
  const service = new PythonSimulationService(pythonEngine);

  return {
    currentVersion: service.getCurrentVersion(),
    supportedVersions: service.getSupportedVersions(),
  };
}
