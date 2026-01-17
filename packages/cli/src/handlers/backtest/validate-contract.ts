/**
 * Handler for validating contract version
 */

import type { CommandContext } from '../../core/command-context.js';
import { PythonSimulationService } from '@quantbot/backtest';
import { ValidationError } from '@quantbot/utils';

export interface ValidateContractArgs {
  version: string;
}

export async function validateContractHandler(
  args: ValidateContractArgs,
  ctx: CommandContext
): Promise<{
  valid: boolean;
  version: string;
  supportedVersions: string[];
  error?: string;
}> {
  const pythonEngine = ctx.services.pythonEngine();
  const service = new PythonSimulationService(pythonEngine);

  try {
    service.validateVersion(args.version);
    return {
      valid: true,
      version: args.version,
      supportedVersions: service.getSupportedVersions(),
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        valid: false,
        version: args.version,
        supportedVersions: service.getSupportedVersions(),
        error: error.message,
      };
    }
    throw error;
  }
}
