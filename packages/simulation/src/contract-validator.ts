/**
 * Contract version validation at runtime
 * 
 * Ensures simulation inputs/outputs conform to expected contract versions.
 */

import { z } from 'zod';
import {
  CURRENT_CONTRACT_VERSION,
  SUPPORTED_CONTRACT_VERSIONS,
  SimInputSchema,
  SimResultSchema,
} from './types/contracts.js';
import type { SimInput, SimResult } from './types/contracts.js';

export class ContractVersionError extends Error {
  constructor(
    message: string,
    public readonly receivedVersion: string,
    public readonly expectedVersions: string[]
  ) {
    super(message);
    this.name = 'ContractVersionError';
  }
}

/**
 * Validate contract version
 */
export function validateContractVersion(version: string): void {
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(version)) {
    throw new ContractVersionError(
      `Unsupported contract version: ${version}. Supported versions: ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}`,
      version,
      SUPPORTED_CONTRACT_VERSIONS
    );
  }
}

/**
 * Validate simulation input contract
 */
export function validateSimInput(input: unknown): SimInput {
  try {
    const parsed = SimInputSchema.parse(input);

    // Validate contract version
    validateContractVersion(parsed.contractVersion);

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid simulation input: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate simulation result contract
 */
export function validateSimResult(result: unknown): SimResult {
  try {
    const parsed = SimResultSchema.parse(result);

    // Validate contract version
    validateContractVersion(parsed.contractVersion);

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid simulation result: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Check if two contract versions are compatible
 */
export function areVersionsCompatible(v1: string, v2: string): boolean {
  // For now, exact match required
  // Future: implement semantic versioning compatibility (major.minor.patch)
  return v1 === v2;
}

/**
 * Get contract version from input/result
 */
export function getContractVersion(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  if ('contractVersion' in data && typeof data.contractVersion === 'string') {
    return data.contractVersion;
  }

  return null;
}

/**
 * Upgrade contract to current version (if possible)
 */
export function upgradeContract(data: unknown, fromVersion: string): unknown {
  // For now, no upgrades needed (only one version)
  // Future: implement version migration logic

  if (fromVersion === CURRENT_CONTRACT_VERSION) {
    return data;
  }

  throw new ContractVersionError(
    `Cannot upgrade from version ${fromVersion} to ${CURRENT_CONTRACT_VERSION}`,
    fromVersion,
    [CURRENT_CONTRACT_VERSION]
  );
}

/**
 * Contract validator class for use in services
 */
export class ContractValidator {
  /**
   * Validate and parse simulation input
   */
  validateInput(input: unknown): SimInput {
    return validateSimInput(input);
  }

  /**
   * Validate and parse simulation result
   */
  validateResult(result: unknown): SimResult {
    return validateSimResult(result);
  }

  /**
   * Check if input version is supported
   */
  isVersionSupported(version: string): boolean {
    return SUPPORTED_CONTRACT_VERSIONS.includes(version);
  }

  /**
   * Get current contract version
   */
  getCurrentVersion(): string {
    return CURRENT_CONTRACT_VERSION;
  }

  /**
   * Get all supported versions
   */
  getSupportedVersions(): string[] {
    return [...SUPPORTED_CONTRACT_VERSIONS];
  }
}

