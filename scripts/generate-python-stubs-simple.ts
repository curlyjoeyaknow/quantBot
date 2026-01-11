#!/usr/bin/env tsx
/**
 * Generate Python Type Stubs from Zod Schemas (Simple Version)
 *
 * This script generates Python TypedDict stubs from JSON Schema representations.
 * Run this after updating Zod schemas to keep Python types in sync.
 *
 * Usage:
 *   pnpm run generate-python-stubs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// =============================================================================
// JSON Schema Definitions (manually extracted from Zod schemas)
// =============================================================================

const schemas = [
  {
    file: 'packages/backtest/python/types/baseline_backtest.pyi',
    types: [
      {
        name: 'BaselineBacktestConfig',
        fields: [
          { name: 'duckdb', type: 'str', required: true },
          { name: 'from_', type: 'str', required: true, comment: '# from in TypeScript' },
          { name: 'to', type: 'str', required: true },
          { name: 'chain', type: 'str', required: false, default: "'solana'" },
          { name: 'interval_seconds', type: 'int', required: false, default: '60' },
          { name: 'horizon_hours', type: 'int', required: false, default: '48' },
          { name: 'pre_window_minutes', type: 'int', required: false, default: '5' },
          { name: 'slice_dir', type: 'str', required: false, default: "'slices/per_token'" },
          { name: 'reuse_slice', type: 'bool', required: false, default: 'False' },
          { name: 'threads', type: 'int', required: false, default: '16' },
          { name: 'min_trades', type: 'int', required: false, default: '10' },
          { name: 'store_duckdb', type: 'bool', required: false, default: 'False' },
          { name: 'run_name', type: 'Optional[str]', required: false },
          {
            name: 'entry_mode',
            type: 'Literal["next_open", "close", "worst_high"]',
            required: false,
            default: '"next_open"',
          },
          { name: 'slippage_bps', type: 'float', required: false, default: '0' },
        ],
      },
      {
        name: 'TokenResult',
        fields: [
          { name: 'alert_id', type: 'int', required: true },
          { name: 'mint', type: 'str', required: true },
          { name: 'caller', type: 'str', required: true },
          { name: 'alert_ts_ms', type: 'int', required: true },
          { name: 'entry_ts_ms', type: 'int', required: true },
          { name: 'status', type: 'str', required: true },
          { name: 'candles', type: 'int', required: true },
          { name: 'entry_price', type: 'Optional[float]', required: true },
          { name: 'ath_mult', type: 'Optional[float]', required: true },
          { name: 'time_to_ath_s', type: 'Optional[float]', required: true },
          { name: 'time_to_recovery_s', type: 'Optional[float]', required: true },
          { name: 'time_to_2x_s', type: 'Optional[float]', required: true },
          { name: 'time_to_3x_s', type: 'Optional[float]', required: true },
          { name: 'time_to_4x_s', type: 'Optional[float]', required: true },
          { name: 'time_to_5x_s', type: 'Optional[float]', required: true },
          { name: 'time_to_10x_s', type: 'Optional[float]', required: true },
          { name: 'time_to_dd_pre2x_s', type: 'Optional[float]', required: true },
          { name: 'time_to_dd_after_2x_s', type: 'Optional[float]', required: true },
          { name: 'time_to_dd_after_3x_s', type: 'Optional[float]', required: true },
          { name: 'dd_initial', type: 'Optional[float]', required: true },
          { name: 'dd_overall', type: 'Optional[float]', required: true },
          { name: 'dd_pre2x', type: 'Optional[float]', required: true },
          { name: 'dd_pre2x_or_horizon', type: 'Optional[float]', required: true },
          { name: 'dd_after_2x', type: 'Optional[float]', required: true },
          { name: 'dd_after_3x', type: 'Optional[float]', required: true },
          { name: 'dd_after_4x', type: 'Optional[float]', required: true },
          { name: 'dd_after_5x', type: 'Optional[float]', required: true },
          { name: 'dd_after_10x', type: 'Optional[float]', required: true },
          { name: 'dd_after_ath', type: 'Optional[float]', required: true },
          { name: 'peak_pnl_pct', type: 'Optional[float]', required: true },
          { name: 'ret_end_pct', type: 'Optional[float]', required: true },
        ],
      },
      {
        name: 'BaselineBacktestSummary',
        fields: [
          { name: 'alerts_total', type: 'int', required: true },
          { name: 'alerts_ok', type: 'int', required: true },
          { name: 'alerts_missing', type: 'int', required: true },
          { name: 'median_ath_mult', type: 'Optional[float]', required: true },
          { name: 'p25_ath_mult', type: 'Optional[float]', required: true },
          { name: 'p75_ath_mult', type: 'Optional[float]', required: true },
          { name: 'p95_ath_mult', type: 'Optional[float]', required: true },
          { name: 'pct_hit_2x', type: 'float', required: true },
          { name: 'pct_hit_3x', type: 'float', required: true },
          { name: 'pct_hit_4x', type: 'float', required: true },
          { name: 'pct_hit_5x', type: 'float', required: true },
          { name: 'pct_hit_10x', type: 'float', required: true },
          { name: 'median_time_to_recovery_s', type: 'Optional[float]', required: true },
          { name: 'median_time_to_2x_s', type: 'Optional[float]', required: true },
          { name: 'median_time_to_3x_s', type: 'Optional[float]', required: true },
          { name: 'median_time_to_ath_s', type: 'Optional[float]', required: true },
          { name: 'median_time_to_dd_pre2x_s', type: 'Optional[float]', required: true },
          { name: 'median_time_to_dd_after_2x_s', type: 'Optional[float]', required: true },
          { name: 'median_dd_initial', type: 'Optional[float]', required: true },
          { name: 'median_dd_overall', type: 'Optional[float]', required: true },
          { name: 'median_dd_pre2x_or_horizon', type: 'Optional[float]', required: true },
          { name: 'median_peak_pnl_pct', type: 'Optional[float]', required: true },
        ],
      },
      {
        name: 'BaselineBacktestResult',
        fields: [
          { name: 'success', type: 'bool', required: true },
          { name: 'run_id', type: 'str', required: true },
          { name: 'stored', type: 'bool', required: true },
          { name: 'out_alerts', type: 'str', required: true },
          { name: 'out_callers', type: 'str', required: true },
          { name: 'summary', type: 'BaselineBacktestSummary', required: true },
          { name: 'callers_count', type: 'int', required: true },
        ],
      },
    ],
  },
  {
    file: 'packages/backtest/python/types/token_slicer.pyi',
    types: [
      {
        name: 'TokenSliceExportConfig',
        fields: [
          { name: 'mint', type: 'str', required: true },
          { name: 'chain', type: 'str', required: false, default: "'solana'" },
          { name: 'alert_ts_ms', type: 'int', required: true },
          { name: 'interval_seconds', type: 'int', required: false, default: '60' },
          { name: 'horizon_hours', type: 'int', required: false, default: '48' },
          { name: 'pre_window_minutes', type: 'int', required: false, default: '5' },
          { name: 'output_dir', type: 'str', required: true },
          { name: 'duckdb', type: 'Optional[str]', required: false },
        ],
      },
      {
        name: 'BatchSliceExportConfig',
        fields: [
          { name: 'duckdb', type: 'str', required: true },
          { name: 'from_', type: 'str', required: true, comment: '# from in TypeScript' },
          { name: 'to', type: 'str', required: true },
          { name: 'chain', type: 'str', required: false, default: "'solana'" },
          { name: 'interval_seconds', type: 'int', required: false, default: '60' },
          { name: 'horizon_hours', type: 'int', required: false, default: '48' },
          { name: 'pre_window_minutes', type: 'int', required: false, default: '5' },
          { name: 'output_dir', type: 'str', required: true },
          { name: 'threads', type: 'int', required: false, default: '16' },
          { name: 'reuse_slice', type: 'bool', required: false, default: 'False' },
        ],
      },
      {
        name: 'SliceExportResult',
        fields: [
          { name: 'success', type: 'bool', required: true },
          { name: 'mint', type: 'str', required: true },
          { name: 'slice_path', type: 'str', required: true },
          { name: 'candles', type: 'int', required: true },
          { name: 'error', type: 'Optional[str]', required: false },
        ],
      },
      {
        name: 'BatchSliceExportResult',
        fields: [
          { name: 'success', type: 'bool', required: true },
          { name: 'total_slices', type: 'int', required: true },
          { name: 'successful', type: 'int', required: true },
          { name: 'failed', type: 'int', required: true },
          { name: 'output_dir', type: 'str', required: true },
          { name: 'slices', type: 'List[SliceExportResult]', required: true },
        ],
      },
    ],
  },
  {
    file: 'packages/backtest/python/types/caller_analysis.pyi',
    types: [
      {
        name: 'CallerAnalysisConfig',
        fields: [
          { name: 'duckdb', type: 'str', required: true },
          { name: 'run_id', type: 'Optional[str]', required: false },
          { name: 'from_', type: 'Optional[str]', required: false, comment: '# from in TypeScript' },
          { name: 'to', type: 'Optional[str]', required: false },
          { name: 'min_trades', type: 'int', required: false, default: '10' },
          { name: 'top', type: 'int', required: false, default: '50' },
          { name: 'format', type: 'Literal["json", "table", "csv"]', required: false, default: '"json"' },
        ],
      },
      {
        name: 'CallerStats',
        fields: [
          { name: 'rank', type: 'int', required: true },
          { name: 'caller', type: 'str', required: true },
          { name: 'n', type: 'int', required: true },
          { name: 'median_ath', type: 'Optional[float]', required: true },
          { name: 'p25_ath', type: 'Optional[float]', required: true },
          { name: 'p75_ath', type: 'Optional[float]', required: true },
          { name: 'p95_ath', type: 'Optional[float]', required: true },
          { name: 'hit2x_pct', type: 'float', required: true },
          { name: 'hit3x_pct', type: 'float', required: true },
          { name: 'hit4x_pct', type: 'float', required: true },
          { name: 'hit5x_pct', type: 'float', required: true },
          { name: 'hit10x_pct', type: 'float', required: true },
          { name: 'median_t_recovery_m', type: 'Optional[float]', required: true },
          { name: 'median_t2x_m', type: 'Optional[float]', required: true },
          { name: 'median_t3x_m', type: 'Optional[float]', required: true },
          { name: 'median_t_ath_m', type: 'Optional[float]', required: true },
          { name: 'median_t_dd_pre2x_m', type: 'Optional[float]', required: true },
          { name: 'median_t2x_hrs', type: 'Optional[float]', required: true },
          { name: 'median_dd_initial_pct', type: 'Optional[float]', required: true },
          { name: 'median_dd_overall_pct', type: 'Optional[float]', required: true },
          { name: 'median_dd_pre2x_pct', type: 'Optional[float]', required: true },
          { name: 'median_dd_pre2x_or_horizon_pct', type: 'Optional[float]', required: true },
          { name: 'median_dd_after_2x_pct', type: 'Optional[float]', required: true },
          { name: 'median_dd_after_3x_pct', type: 'Optional[float]', required: true },
          { name: 'median_dd_after_ath_pct', type: 'Optional[float]', required: true },
          { name: 'worst_dd_pct', type: 'Optional[float]', required: true },
          { name: 'median_peak_pnl_pct', type: 'Optional[float]', required: true },
          { name: 'median_ret_end_pct', type: 'Optional[float]', required: true },
        ],
      },
      {
        name: 'CallerScoring',
        fields: [
          { name: 'rank', type: 'int', required: true },
          { name: 'caller', type: 'str', required: true },
          { name: 'n', type: 'int', required: true },
          { name: 'median_ath', type: 'Optional[float]', required: true },
          { name: 'p75_ath', type: 'Optional[float]', required: true },
          { name: 'p95_ath', type: 'Optional[float]', required: true },
          { name: 'hit2x_pct', type: 'float', required: true },
          { name: 'hit3x_pct', type: 'float', required: true },
          { name: 'hit4x_pct', type: 'float', required: true },
          { name: 'hit5x_pct', type: 'float', required: true },
          { name: 'median_t2x_hrs', type: 'Optional[float]', required: true },
          { name: 'median_t2x_min', type: 'Optional[float]', required: true },
          { name: 'median_dd_pre2x_pct', type: 'Optional[float]', required: true },
          { name: 'median_dd_pre2x_or_horizon_pct', type: 'Optional[float]', required: true },
          { name: 'risk_dd_pct', type: 'Optional[float]', required: true },
          { name: 'risk_mag', type: 'float', required: true },
          { name: 'base_upside', type: 'float', required: true },
          { name: 'tail_bonus', type: 'float', required: true },
          { name: 'fast2x_signal', type: 'float', required: true },
          { name: 'discipline_bonus', type: 'float', required: true },
          { name: 'risk_penalty', type: 'float', required: true },
          { name: 'confidence', type: 'float', required: true },
          { name: 'score_v2', type: 'float', required: true },
        ],
      },
      {
        name: 'CallerAnalysisResult',
        fields: [
          { name: 'success', type: 'bool', required: true },
          { name: 'run_id', type: 'Optional[str]', required: false },
          { name: 'callers', type: 'List[CallerStats]', required: true },
          { name: 'scored_callers', type: 'Optional[List[CallerScoring]]', required: false },
          { name: 'total_callers', type: 'int', required: true },
        ],
      },
    ],
  },
];

// =============================================================================
// Generate TypedDict
// =============================================================================

function generateTypedDict(typeDef: any): string {
  const lines: string[] = [];
  const imports = new Set<string>(['from typing import TypedDict']);

  // Collect imports
  for (const field of typeDef.fields) {
    if (field.type.includes('Optional')) {
      imports.add('from typing import Optional');
    }
    if (field.type.includes('Literal')) {
      imports.add('from typing import Literal');
    }
    if (field.type.includes('List')) {
      imports.add('from typing import List');
    }
    if (field.type.includes('Dict')) {
      imports.add('from typing import Dict');
    }
  }

  // Class definition
  const hasOptional = typeDef.fields.some((f: any) => !f.required);
  lines.push(`class ${typeDef.name}(TypedDict${hasOptional ? ', total=False' : ''}):`);
  lines.push('    """');
  lines.push(`    ${typeDef.name} type definition.`);
  lines.push('    Auto-generated from Zod schema.');
  lines.push('    """');

  // Fields
  const requiredFields = typeDef.fields.filter((f: any) => f.required);
  const optionalFields = typeDef.fields.filter((f: any) => !f.required);

  if (requiredFields.length > 0 && optionalFields.length > 0) {
    lines.push('    # Required fields');
  }

  for (const field of requiredFields) {
    const comment = field.comment ? `  ${field.comment}` : '';
    lines.push(`    ${field.name}: ${field.type}${comment}`);
  }

  if (optionalFields.length > 0) {
    if (requiredFields.length > 0) {
      lines.push('');
      lines.push('    # Optional fields');
    }
    for (const field of optionalFields) {
      const comment = field.comment ? `  ${field.comment}` : '';
      const defaultComment = field.default ? `  # default: ${field.default}` : '';
      lines.push(`    ${field.name}: ${field.type}${comment}${defaultComment}`);
    }
  }

  return { imports, content: lines.join('\n') };
}

// =============================================================================
// Main
// =============================================================================

function main() {
  console.log('🔧 Generating Python type stubs from Zod schemas...\n');

  let totalGenerated = 0;

  for (const schema of schemas) {
    console.log(`📝 Generating ${schema.file}...`);

    const allImports = new Set<string>();
    const allContent: string[] = [];

    for (const typeDef of schema.types) {
      const { imports, content } = generateTypedDict(typeDef);
      imports.forEach((imp) => allImports.add(imp));
      allContent.push(content);
      console.log(`   ✅ ${typeDef.name}`);
      totalGenerated++;
    }

    // Build file content
    const fileLines: string[] = [];
    fileLines.push('"""Auto-generated Python type stubs from Zod schemas."""');
    fileLines.push('');
    Array.from(allImports)
      .sort()
      .forEach((imp) => fileLines.push(imp));
    fileLines.push('');
    fileLines.push('');
    fileLines.push(allContent.join('\n\n'));

    // Write to file
    const fullPath = join(process.cwd(), schema.file);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, fileLines.join('\n') + '\n');
  }

  console.log(`\n✨ Generated ${totalGenerated} type stubs in ${schemas.length} files`);
  console.log('\n💡 Usage in Python:');
  console.log(
    '   from packages.backtest.python.types.baseline_backtest import BaselineBacktestConfig'
  );
  console.log(
    '   \n   def run_baseline(config: BaselineBacktestConfig) -> BaselineBacktestResult:'
  );
  console.log('       ...');
}

main();
