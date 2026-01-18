/**
 * CLI Composition Root for Listing Strategies
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Do I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import type { ListStrategiesArgs } from '../../command-defs/simulation.js';
import { StrategiesRepository } from '@quantbot/infra/storage';
import process from 'node:process';

/**
 * CLI handler for listing strategies
 *
 * This function can:
 * - Read process.env ✅
 * - Do I/O ✅
 *
 * Uses strategiesRepository() from CommandContext when no custom duckdb path is provided.
 * Direct instantiation is acceptable when a custom path is needed (composition root).
 */
export async function listStrategiesHandler(args: ListStrategiesArgs, ctx: CommandContext) {
  // Use repository from context (proper wiring)
  // If duckdb path is provided, we still need to create a new instance with that path
  // This is acceptable - the handler is a composition root
  const strategiesRepo = args.duckdb
    ? new StrategiesRepository(args.duckdb)
    : ctx.services.strategiesRepository();

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
