/**
 * Orchestrator Helper with Storage
 * =================================
 * Helper function to create an orchestrator with storage sink enabled by default.
 */

import { createOrchestrator, type OrchestratorDeps } from '../core/orchestrator';
import { createStorageSink, type StorageSinkConfig } from './storage-sink';

/**
 * Create an orchestrator with storage enabled
 */
export function createOrchestratorWithStorage(
  storageConfig?: StorageSinkConfig,
  deps?: OrchestratorDeps
) {
  const orchestrator = createOrchestrator(deps);
  
  // Add storage sink
  const storageSink = createStorageSink(storageConfig);
  orchestrator.addSink(storageSink);
  
  return orchestrator;
}

