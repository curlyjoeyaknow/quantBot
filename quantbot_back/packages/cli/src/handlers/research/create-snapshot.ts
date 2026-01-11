/**
 * Create Snapshot Handler
 *
 * Creates a data snapshot using DataSnapshotService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { DataSnapshotService } from '@quantbot/workflows';
import { createProductionContext } from '@quantbot/workflows';
import type { z } from 'zod';

export type CreateSnapshotArgs = z.infer<
  typeof import('../../command-defs/research.js').createSnapshotSchema
>;

export async function createSnapshotHandler(args: CreateSnapshotArgs, _ctx: CommandContext) {
  // Create workflow context from command context
  const workflowCtx = createProductionContext();

  // Create service
  const dataService = new DataSnapshotService(workflowCtx);

  // Create snapshot
  const snapshot = await dataService.createSnapshot({
    timeRange: {
      fromISO: args.from,
      toISO: args.to,
    },
    sources: args.sources || [{ venue: 'pump.fun', chain: 'solana' }],
    filters: {
      callerNames: args.callerNames,
      mintAddresses: args.mintAddresses,
      minVolume: args.minVolume,
    },
  });

  return {
    snapshotId: snapshot.snapshotId,
    contentHash: snapshot.contentHash,
    timeRange: snapshot.timeRange,
    sources: snapshot.sources,
    filters: snapshot.filters,
    schemaVersion: snapshot.schemaVersion,
    createdAtISO: snapshot.createdAtISO,
  };
}
