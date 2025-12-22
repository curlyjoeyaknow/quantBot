import type { ProductionPorts } from './ports.js';

/**
 * WorkflowContext with ports
 *
 * This is the new structure that includes ports.
 * Existing WorkflowContext in types.ts will be gradually migrated to use this.
 */
export type WorkflowContextWithPorts = {
  ports: ProductionPorts;

  // Optional: leave room for safe, non-client config/data
  // config?: Record<string, unknown>;
};
