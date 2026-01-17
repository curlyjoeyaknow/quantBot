/**
 * @quantbot/simulation - DEPRECATED
 * ==================================
 *
 * ⚠️  This package is deprecated. Use @quantbot/backtest instead.
 *
 * This package now serves as a backward compatibility layer, re-exporting
 * functionality from @quantbot/backtest. All new code should import from
 * @quantbot/backtest directly.
 *
 * Migration guide:
 * - Replace `import { ... } from '@quantbot/simulation'` with `import { ... } from '@quantbot/backtest'`
 * - Replace `import { ... } from '@quantbot/simulation/core'` with `import { ... } from '@quantbot/backtest'`
 * - Replace `import { ... } from '@quantbot/simulation/indicators'` with `import { ... } from '@quantbot/backtest'`
 * - Replace `import { ... } from '@quantbot/simulation/execution-models'` with `import { ... } from '@quantbot/backtest'`
 *
 * This package will be removed in a future major version.
 */

// Re-export everything from @quantbot/backtest for backward compatibility
export * from '@quantbot/backtest';
