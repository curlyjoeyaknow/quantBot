import type { CommandContext } from '../../core/command-context.js';
import { type HealthObservabilityArgs } from '../../command-defs/observability.js';
import { performHealthCheck } from '@quantbot/observability';

export async function healthObservabilityHandler(
  _args: HealthObservabilityArgs,
  _ctx: CommandContext
) {
  return await performHealthCheck();
}
