/**
 * Orchestrator Helper with Storage
 * =================================
 * Helper function to create an orchestrator with storage sink enabled by default.
 *
 * @deprecated This has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/storage/orchestrator-helper instead.
 * This file will be removed in a future version.
 */

/**
 * @deprecated This has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/storage/orchestrator-helper instead.
 */
import { SimulationOrchestrator, type OrchestratorDeps } from '../core/orchestrator';
import { createStorageSink, type StorageSinkConfig } from './storage-sink';

/**
 * Create an orchestrator with storage enabled
 */
export function createOrchestratorWithStorage(
  storageConfig?: StorageSinkConfig,
  deps?: OrchestratorDeps
) {
  const orchestrator = new SimulationOrchestrator(deps);

  // Add storage sink
  const storageSink = createStorageSink(storageConfig);
  orchestrator.addSink(storageSink);

  return orchestrator;
}
