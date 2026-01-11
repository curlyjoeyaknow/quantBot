/**
 * Structured Artifacts Demo
 *
 * Demonstrates the structured artifacts system for backtest runs.
 */

import { DuckDBClient } from '@quantbot/storage';
import {
  createRunDirectory,
  getGitProvenance,
  catalogAllRuns,
  initializeCatalog,
  queryRuns,
  getArtifactPath,
  getCatalogStats,
  type AlertArtifact,
  type PathArtifact,
  type SummaryArtifact,
} from '@quantbot/backtest';

async function demo() {
  console.log('=== Structured Artifacts Demo ===\n');

  // ============================================================================
  // Part 1: Create a Run with Artifacts
  // ============================================================================

  console.log('Part 1: Creating a run with artifacts...\n');

  const runId = 'demo-run-' + Date.now();
  const runDir = await createRunDirectory(runId, 'path-only', {
    baseDir: 'examples/demo-runs',
  });

  console.log(`✓ Created run directory: ${runDir.getRunDir()}`);

  // Set git provenance
  const gitInfo = await getGitProvenance();
  runDir.updateManifest({
    git_commit: gitInfo.commit,
    git_branch: gitInfo.branch,
    git_dirty: gitInfo.dirty,
    dataset: {
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-31T23:59:59Z',
      interval: '5m',
      calls_count: 100,
    },
  });

  console.log(`✓ Set git provenance: ${gitInfo.commit?.slice(0, 8)} (${gitInfo.branch})`);

  // Write alerts artifact
  const alertArtifacts: AlertArtifact[] = [
    {
      call_id: 'call-1',
      mint: 'So11111111111111111111111111111111111111112',
      caller_name: 'alice',
      chain: 'solana',
      alert_ts_ms: Date.parse('2024-01-15T10:00:00Z'),
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      call_id: 'call-2',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      caller_name: 'bob',
      chain: 'solana',
      alert_ts_ms: Date.parse('2024-01-16T14:30:00Z'),
      created_at: '2024-01-16T14:30:00Z',
    },
  ];

  await runDir.writeArtifact('alerts', alertArtifacts as any);
  console.log(`✓ Wrote alerts artifact: ${alertArtifacts.length} rows`);

  // Write paths artifact
  const pathArtifacts: PathArtifact[] = [
    {
      run_id: runId,
      call_id: 'call-1',
      caller_name: 'alice',
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      interval: '5m',
      alert_ts_ms: Date.parse('2024-01-15T10:00:00Z'),
      p0: 100.0,
      hit_2x: true,
      t_2x_ms: 3600000, // 1 hour
      hit_3x: false,
      t_3x_ms: null,
      hit_4x: false,
      t_4x_ms: null,
      dd_bps: 250, // 2.5% drawdown
      dd_to_2x_bps: 150,
      alert_to_activity_ms: 300000, // 5 minutes
      peak_multiple: 2.3,
    },
    {
      run_id: runId,
      call_id: 'call-2',
      caller_name: 'bob',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      chain: 'solana',
      interval: '5m',
      alert_ts_ms: Date.parse('2024-01-16T14:30:00Z'),
      p0: 50.0,
      hit_2x: false,
      t_2x_ms: null,
      hit_3x: false,
      t_3x_ms: null,
      hit_4x: false,
      t_4x_ms: null,
      dd_bps: 800, // 8% drawdown
      dd_to_2x_bps: null,
      alert_to_activity_ms: 600000, // 10 minutes
      peak_multiple: 1.5,
    },
  ];

  await runDir.writeArtifact('paths', pathArtifacts as any);
  console.log(`✓ Wrote paths artifact: ${pathArtifacts.length} rows`);

  // Write summary artifact
  const summaryArtifact: SummaryArtifact = {
    run_id: runId,
    calls_processed: 2,
    calls_excluded: 0,
    trades_count: 0,
    avg_return_bps: 0,
    median_return_bps: 0,
    stop_out_rate: 0,
    avg_max_adverse_excursion_bps: 0,
    avg_time_exposed_ms: 0,
    avg_tail_capture: null,
    median_tail_capture: null,
  };

  await runDir.writeArtifact('summary', [summaryArtifact] as any);
  console.log(`✓ Wrote summary artifact: 1 row`);

  // Update timing and mark success
  runDir.updateManifest({
    timing: {
      plan_ms: 100,
      coverage_ms: 200,
      slice_ms: 300,
      execution_ms: 400,
      total_ms: 1000,
    },
  });

  await runDir.markSuccess();
  console.log(`✓ Marked run as successful\n`);

  // ============================================================================
  // Part 2: Catalog Sync
  // ============================================================================

  console.log('Part 2: Syncing to catalog...\n');

  const catalogPath = 'examples/demo-catalog.duckdb';
  const db = new DuckDBClient(catalogPath);

  try {
    // Initialize catalog
    await initializeCatalog(db);
    console.log(`✓ Initialized catalog: ${catalogPath}`);

    // Catalog all runs
    const result = await catalogAllRuns(db, 'examples/demo-runs');
    console.log(`✓ Cataloged runs: ${result.registered} registered, ${result.skipped} skipped\n`);

    // ============================================================================
    // Part 3: Query Catalog
    // ============================================================================

    console.log('Part 3: Querying catalog...\n');

    // Query all runs
    const runs = await queryRuns(db, { limit: 10 });
    console.log(`Found ${runs.length} run(s):`);
    for (const run of runs) {
      console.log(`  - ${run.run_id} (${run.run_type})`);
      console.log(`    Status: ${run.status}`);
      console.log(`    Created: ${run.created_at}`);
      console.log(`    Git: ${run.git_commit?.slice(0, 8)} (${run.git_branch})`);
      console.log(`    Artifacts: ${Object.keys(run.artifacts).join(', ')}`);
    }
    console.log();

    // Get artifact path
    const pathsFile = await getArtifactPath(db, runId, 'paths');
    console.log(`Paths artifact location: ${pathsFile}\n`);

    // Get catalog stats
    const stats = await getCatalogStats(db);
    console.log('Catalog Statistics:');
    console.log(`  Total runs: ${stats.totalRuns}`);
    console.log(`  Completed: ${stats.completedRuns}`);
    console.log(`  Failed: ${stats.failedRuns}`);
    console.log(`  By type:`, stats.runsByType);
    console.log(`  Total artifacts: ${stats.totalArtifacts}`);
    console.log(`  By type:`, stats.artifactsByType);
    console.log();

    // ============================================================================
    // Part 4: Read Artifacts Directly
    // ============================================================================

    console.log('Part 4: Reading artifacts directly...\n');

    // Read paths artifact with DuckDB
    const pathsQuery = `
      SELECT
        call_id,
        caller_name,
        hit_2x,
        peak_multiple,
        dd_bps
      FROM read_parquet('${pathsFile}')
    `;

    const pathsData = await db.execute(pathsQuery);
    console.log('Paths data:');
    console.table(pathsData);

    // ============================================================================
    // Part 5: Analysis Example
    // ============================================================================

    console.log('Part 5: Analysis example...\n');

    const analysisQuery = `
      SELECT
        caller_name,
        COUNT(*) as calls,
        AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
        AVG(peak_multiple) as avg_peak_multiple,
        AVG(dd_bps) as avg_drawdown_bps
      FROM read_parquet('${pathsFile}')
      GROUP BY caller_name
      ORDER BY hit_rate_2x DESC
    `;

    const analysisData = await db.execute(analysisQuery);
    console.log('Caller analysis:');
    console.table(analysisData);

  } finally {
    await db.close();
  }

  console.log('\n=== Demo Complete ===');
  console.log(`\nRun directory: ${runDir.getRunDir()}`);
  console.log(`Catalog database: ${catalogPath}`);
  console.log('\nCleanup:');
  console.log(`  rm -rf examples/demo-runs`);
  console.log(`  rm examples/demo-catalog.duckdb`);
}

// Run demo
demo().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});

