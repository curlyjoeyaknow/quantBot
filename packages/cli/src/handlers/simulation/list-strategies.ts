/**
 * Handler for simulation list-strategies command
 *
 * Lists all strategies available in DuckDB using StrategiesRepository.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { ListStrategiesArgs } from '../../command-defs/simulation.js';
import { StrategiesRepository } from '@quantbot/storage';

export async function listStrategiesHandler(args: ListStrategiesArgs, _ctx: CommandContext) {
  // Get DuckDB path from args or environment
  const dbPath = args.duckdb || process.env.DUCKDB_PATH || 'data/quantbot.db';

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
