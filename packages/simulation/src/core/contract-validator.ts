/**
 * Simulation Contract Validator
 *
 * Validates simulation inputs against the contract schema
 * and ensures all required fields are present.
 */

import type { SimInput } from '../types/contracts.js';
import { SimInputSchema } from '../types/contracts.js';
import { ValidationError } from '@quantbot/utils';

/**
 * Validate simulation input contract
 *
 * @throws ValidationError if contract is invalid
 */
export function validateSimulationContract(input: unknown): SimInput {
  try {
    return SimInputSchema.parse(input);
  } catch (error) {
    if (error instanceof Error) {
      throw new ValidationError(`Invalid simulation contract: ${error.message}`, {
        input,
        error,
      });
    }
    throw new ValidationError('Invalid simulation contract', { input, error });
  }
}

/**
 * Validate contract version compatibility
 */
export function validateContractVersion(
  contractVersion: string,
  supportedVersions: string[] = ['1.0.0']
): void {
  if (!supportedVersions.includes(contractVersion)) {
    throw new ValidationError(
      `Unsupported contract version: ${contractVersion}. Supported: ${supportedVersions.join(', ')}`,
      { contractVersion, supportedVersions }
    );
  }
}
