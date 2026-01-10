#!/usr/bin/env node
/**
 * Quick smoke test for sweep runner
 * Bypasses CLI build issues for immediate testing
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { DateTime } from 'luxon';

// Import directly from source (bypass build)
const { evaluateCallsWorkflow, createProductionContextWithPorts } = await import('../packages/workflows/src/calls/evaluate.js');
const { alignCallToOhlcvWindow } = await import('../packages/workflows/src/calls/align.js');

// Load test calls
const calls = JSON.parse(readFileSync('out/smoke-test/calls.json', 'utf-8'));
const overlaySets = JSON.parse(readFileSync('out/smoke-test/overlays.json', 'utf-8'));

console.log('🚀 Starting smoke test sweep...');
console.log(`Calls: ${calls.length}`);
console.log(`Overlay sets: ${overlaySets.length}`);
console.log(`Intervals: ["5m"]`);
console.log(`Lags: [0, 10000]`);

const sweepId = `sweep-${DateTime.utc().toFormat('yyyyMMdd-HHmmss')}`;
const outDir = 'out/smoke-test/sweep-001';
mkdirSync(outDir, { recursive: true });

const ctx = await createProductionContextWithPorts();

const allPerCallRows = [];
const allPerCallerRows = [];

// Run sweep
for (const interval of ['5m']) {
  for (const lagMs of [0, 10000]) {
    for (let i = 0; i < overlaySets.length; i++) {
      const overlaySet = overlaySets[i];
      const overlaySetId = `set-${i}`;
      
      console.log(`\n📊 Running: interval=${interval}, lagMs=${lagMs}, overlaySet=${overlaySetId}`);
      
      const result = await evaluateCallsWorkflow({
        calls,
        align: {
          lagMs,
          entryRule: 'next_candle_open',
          timeframeMs: 24 * 60 * 60 * 1000,
          interval: interval,
        },
        backtest: {
          fee: { takerFeeBps: 30, slippageBps: 10 },
          overlays: overlaySet,
          position: { notionalUsd: 1000 },
        },
      }, ctx);
      
      console.log(`  ✅ Results: ${result.results.length}, Callers: ${result.summaryByCaller.length}`);
      
      // Convert to rows (simplified)
      for (const res of result.results) {
        allPerCallRows.push({
          sweepId,
          lagMs,
          interval,
          overlaySetId,
          callTsMs: res.call.tsMs,
          callerFromId: res.call.caller.fromId,
          callerName: res.call.caller.displayName,
          tokenAddress: res.call.token.address,
          tokenChain: res.call.token.chain,
          overlay: res.overlay,
          entry: res.entry,
          exit: res.exit,
          pnl: res.pnl,
          diagnostics: res.diagnostics,
        });
      }
      
      for (const summary of result.summaryByCaller) {
        allPerCallerRows.push({
          sweepId,
          lagMs,
          interval,
          overlaySetId,
          ...summary,
        });
      }
    }
  }
}

// Write outputs
writeFileSync(
  join(outDir, 'per_call.jsonl'),
  allPerCallRows.map(r => JSON.stringify(r)).join('\n') + '\n'
);

writeFileSync(
  join(outDir, 'per_caller.jsonl'),
  allPerCallerRows.map(r => JSON.stringify(r)).join('\n') + '\n'
);

// Write metadata
const metadata = {
  sweepId,
  startedAtISO: DateTime.utc().toISO(),
  completedAtISO: DateTime.utc().toISO(),
  gitSha: execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim(),
  configHash: createHash('sha256').update(JSON.stringify({ calls: calls.length, overlaySets: overlaySets.length })).digest('hex').substring(0, 16),
  counts: {
    totalRuns: 4, // 2 intervals * 2 lags * 1 overlaySet
    totalResults: allPerCallRows.length,
    totalCallerSummaries: allPerCallerRows.length,
  },
};

writeFileSync(
  join(outDir, 'run.meta.json'),
  JSON.stringify(metadata, null, 2)
);

console.log(`\n✅ Sweep complete!`);
console.log(`   Output: ${outDir}`);
console.log(`   Per-call rows: ${allPerCallRows.length}`);
console.log(`   Per-caller rows: ${allPerCallerRows.length}`);

