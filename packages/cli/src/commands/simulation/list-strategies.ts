/**
 * CLI Composition Root for Listing Strategies
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Do I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import type { ListStrategiesArgs } from '../../command-defs/simulation.js';
import { StrategiesRepository } from '@quantbot/storage';
import process from 'node:process';

/**
 * CLI handler for listing strategies
 *
 * This function can:
 * - Read process.env ✅
 * - Do I/O ✅
 */
export async function listStrategiesHandler(args: ListStrategiesArgs, _ctx: CommandContext) {
  // ENV LIVE HERE (composition root)
  const dbPath = args.duckdb || process.env.DUCKDB_PATH || 'data/tele.duckdb';

  const strategiesRepo = new StrategiesRepository(dbPath);

  const strategies = await strategiesRepo.list();

  return {
    strategies: strategies.map((s) => ({
      id: s.name, // Use name as identifier (repository doesn't expose id)
      name: s.name,
      version: s.version,
      category: s.category,
      description: s.description,
      isActive: s.isActive,
      createdAt: s.createdAt.toISO(),
      updatedAt: s.updatedAt.toISO(),
      config: s.config,
    })),
    count: strategies.length,
  };
}
