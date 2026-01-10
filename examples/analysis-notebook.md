# Backtest Analysis Notebook

This notebook demonstrates common analysis patterns using the structured artifacts system.

## Setup

```typescript
import { DuckDBClient } from '@quantbot/storage';
import { queryRuns, getArtifactPath, getCatalogStats } from '@quantbot/backtest';
import duckdb from 'duckdb';

// Open catalog
const catalogDb = new DuckDBClient('data/backtest_catalog.duckdb');

// For ad-hoc queries
const db = new duckdb.Database(':memory:');
```

## 1. Catalog Overview

### Get Catalog Statistics

```typescript
const stats = await getCatalogStats(catalogDb);

console.log('Catalog Statistics:');
console.log(`  Total runs: ${stats.totalRuns}`);
console.log(`  Completed: ${stats.completedRuns}`);
console.log(`  Failed: ${stats.failedRuns}`);
console.log(`  By type:`, stats.runsByType);
console.log(`  Total artifacts: ${stats.totalArtifacts}`);
console.log(`  By type:`, stats.artifactsByType);
```

### List Recent Runs

```typescript
const recentRuns = await queryRuns(catalogDb, {
  status: 'completed',
  limit: 10,
});

console.table(recentRuns.map(r => ({
  run_id: r.run_id.slice(0, 8),
  run_type: r.run_type,
  created_at: r.created_at,
  git_branch: r.git_branch,
  calls: r.dataset.calls_count,
})));
```

## 2. Caller Analysis

### Find Best Callers (Path-Only)

```sql
SELECT
  caller_name,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
  AVG(CASE WHEN hit_3x THEN 1.0 ELSE 0.0 END) as hit_rate_3x,
  AVG(peak_multiple) as avg_peak_multiple,
  AVG(dd_bps) as avg_drawdown_bps,
  AVG(alert_to_activity_ms) / 60000.0 as avg_time_to_activity_min
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
GROUP BY caller_name
HAVING calls >= 10
ORDER BY hit_rate_2x DESC
LIMIT 20;
```

### Caller Performance Over Time

```sql
SELECT
  DATE_TRUNC('week', TIMESTAMP 'epoch' + alert_ts_ms * INTERVAL '1 millisecond') as week,
  caller_name,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
  AVG(peak_multiple) as avg_peak_multiple
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
WHERE caller_name IN ('alice', 'bob', 'charlie')
GROUP BY week, caller_name
ORDER BY week, caller_name;
```

### Caller Consistency (Multiple Runs)

```sql
WITH caller_metrics AS (
  SELECT
    r.run_id,
    r.created_at,
    p.caller_name,
    AVG(CASE WHEN p.hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
    COUNT(*) as calls
  FROM backtest_runs_catalog r
  JOIN backtest_artifacts_catalog a ON r.run_id = a.run_id
  CROSS JOIN read_parquet(a.artifact_path) p
  WHERE r.run_type = 'path-only'
    AND r.status = 'completed'
    AND a.artifact_type = 'paths'
  GROUP BY r.run_id, r.created_at, p.caller_name
  HAVING calls >= 10
)
SELECT
  caller_name,
  COUNT(DISTINCT run_id) as runs,
  AVG(hit_rate_2x) as avg_hit_rate_2x,
  STDDEV(hit_rate_2x) as stddev_hit_rate_2x,
  MIN(hit_rate_2x) as min_hit_rate_2x,
  MAX(hit_rate_2x) as max_hit_rate_2x
FROM caller_metrics
GROUP BY caller_name
HAVING runs >= 3
ORDER BY avg_hit_rate_2x DESC;
```

## 3. Policy Comparison

### Compare Two Policies

```sql
WITH policy_a AS (
  SELECT * FROM read_parquet('runs/2024-01/run_id=<policy-a>/policy/trades.parquet')
),
policy_b AS (
  SELECT * FROM read_parquet('runs/2024-01/run_id=<policy-b>/policy/trades.parquet')
)
SELECT
  'Policy A' as policy,
  COUNT(*) as trades,
  AVG(realized_return_bps) as avg_return_bps,
  MEDIAN(realized_return_bps) as median_return_bps,
  AVG(CASE WHEN stop_out THEN 1.0 ELSE 0.0 END) as stop_out_rate,
  AVG(time_exposed_ms) / 3600000.0 as avg_time_exposed_hrs,
  AVG(max_adverse_excursion_bps) as avg_mae_bps
FROM policy_a
UNION ALL
SELECT
  'Policy B' as policy,
  COUNT(*) as trades,
  AVG(realized_return_bps) as avg_return_bps,
  MEDIAN(realized_return_bps) as median_return_bps,
  AVG(CASE WHEN stop_out THEN 1.0 ELSE 0.0 END) as stop_out_rate,
  AVG(time_exposed_ms) / 3600000.0 as avg_time_exposed_hrs,
  AVG(max_adverse_excursion_bps) as avg_mae_bps
FROM policy_b;
```

### Policy Performance by Caller

```sql
SELECT
  caller_name,
  COUNT(*) as trades,
  AVG(realized_return_bps) as avg_return_bps,
  MEDIAN(realized_return_bps) as median_return_bps,
  AVG(CASE WHEN stop_out THEN 1.0 ELSE 0.0 END) as stop_out_rate,
  AVG(tail_capture) as avg_tail_capture
FROM (
  SELECT
    t.*,
    a.caller_name
  FROM read_parquet('runs/2024-01/run_id=<uuid>/policy/trades.parquet') t
  JOIN read_parquet('runs/2024-01/run_id=<uuid>/inputs/alerts.parquet') a
    ON t.call_id = a.call_id
)
GROUP BY caller_name
HAVING trades >= 10
ORDER BY avg_return_bps DESC;
```

## 4. Optimization Frontier Analysis

### View Optimization Frontier

```sql
SELECT
  caller_name,
  rank,
  meets_constraints,
  objective_score,
  avg_return_bps,
  median_return_bps,
  stop_out_rate,
  policy_params
FROM read_parquet('runs/2024-01/run_id=<uuid>/results/frontier.parquet')
WHERE caller_name = 'alice'
ORDER BY rank
LIMIT 20;
```

### Frontier Pareto Analysis

```sql
WITH frontier AS (
  SELECT
    caller_name,
    avg_return_bps,
    stop_out_rate,
    meets_constraints
  FROM read_parquet('runs/2024-01/run_id=<uuid>/results/frontier.parquet')
  WHERE meets_constraints = true
)
SELECT
  caller_name,
  COUNT(*) as feasible_policies,
  MAX(avg_return_bps) as max_return_bps,
  MIN(stop_out_rate) as min_stop_out_rate,
  -- Pareto optimal: highest return for given stop-out rate
  COUNT(CASE
    WHEN avg_return_bps = (
      SELECT MAX(f2.avg_return_bps)
      FROM frontier f2
      WHERE f2.caller_name = frontier.caller_name
        AND f2.stop_out_rate <= frontier.stop_out_rate
    ) THEN 1
  END) as pareto_optimal_count
FROM frontier
GROUP BY caller_name
ORDER BY max_return_bps DESC;
```

## 5. Time Series Analysis

### Daily Performance Trends

```sql
SELECT
  DATE_TRUNC('day', TIMESTAMP 'epoch' + alert_ts_ms * INTERVAL '1 millisecond') as day,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
  AVG(peak_multiple) as avg_peak_multiple,
  AVG(dd_bps) as avg_drawdown_bps
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
GROUP BY day
ORDER BY day;
```

### Intraday Patterns

```sql
SELECT
  EXTRACT(HOUR FROM TIMESTAMP 'epoch' + alert_ts_ms * INTERVAL '1 millisecond') as hour_of_day,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
  AVG(peak_multiple) as avg_peak_multiple
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
GROUP BY hour_of_day
ORDER BY hour_of_day;
```

### Day of Week Analysis

```sql
SELECT
  DAYNAME(TIMESTAMP 'epoch' + alert_ts_ms * INTERVAL '1 millisecond') as day_of_week,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
  AVG(peak_multiple) as avg_peak_multiple
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
GROUP BY day_of_week
ORDER BY
  CASE day_of_week
    WHEN 'Monday' THEN 1
    WHEN 'Tuesday' THEN 2
    WHEN 'Wednesday' THEN 3
    WHEN 'Thursday' THEN 4
    WHEN 'Friday' THEN 5
    WHEN 'Saturday' THEN 6
    WHEN 'Sunday' THEN 7
  END;
```

## 6. Risk Analysis

### Drawdown Distribution

```sql
SELECT
  CASE
    WHEN dd_bps < 100 THEN '0-1%'
    WHEN dd_bps < 300 THEN '1-3%'
    WHEN dd_bps < 500 THEN '3-5%'
    WHEN dd_bps < 1000 THEN '5-10%'
    WHEN dd_bps < 2000 THEN '10-20%'
    ELSE '20%+'
  END as drawdown_bucket,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
  AVG(peak_multiple) as avg_peak_multiple
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
GROUP BY drawdown_bucket
ORDER BY
  CASE drawdown_bucket
    WHEN '0-1%' THEN 1
    WHEN '1-3%' THEN 2
    WHEN '3-5%' THEN 3
    WHEN '5-10%' THEN 4
    WHEN '10-20%' THEN 5
    ELSE 6
  END;
```

### Max Adverse Excursion Analysis

```sql
SELECT
  CASE
    WHEN max_adverse_excursion_bps < 100 THEN '0-1%'
    WHEN max_adverse_excursion_bps < 300 THEN '1-3%'
    WHEN max_adverse_excursion_bps < 500 THEN '3-5%'
    WHEN max_adverse_excursion_bps < 1000 THEN '5-10%'
    ELSE '10%+'
  END as mae_bucket,
  COUNT(*) as trades,
  AVG(realized_return_bps) as avg_return_bps,
  AVG(CASE WHEN stop_out THEN 1.0 ELSE 0.0 END) as stop_out_rate
FROM read_parquet('runs/2024-01/run_id=<uuid>/policy/trades.parquet')
GROUP BY mae_bucket
ORDER BY
  CASE mae_bucket
    WHEN '0-1%' THEN 1
    WHEN '1-3%' THEN 2
    WHEN '3-5%' THEN 3
    WHEN '5-10%' THEN 4
    ELSE 5
  END;
```

## 7. Cross-Run Comparisons

### Compare Runs Across Git Branches

```sql
SELECT
  r.git_branch,
  COUNT(DISTINCT r.run_id) as runs,
  AVG(p.hit_rate_2x) as avg_hit_rate_2x,
  AVG(p.avg_peak_multiple) as avg_peak_multiple
FROM backtest_runs_catalog r
JOIN (
  SELECT
    run_id,
    AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
    AVG(peak_multiple) as avg_peak_multiple
  FROM (
    SELECT
      a.run_id,
      p.*
    FROM backtest_artifacts_catalog a
    CROSS JOIN read_parquet(a.artifact_path) p
    WHERE a.artifact_type = 'paths'
  )
  GROUP BY run_id
) p ON r.run_id = p.run_id
WHERE r.run_type = 'path-only'
  AND r.status = 'completed'
GROUP BY r.git_branch
ORDER BY avg_hit_rate_2x DESC;
```

### Performance Regression Detection

```sql
WITH recent_runs AS (
  SELECT
    r.run_id,
    r.created_at,
    AVG(CASE WHEN p.hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x
  FROM backtest_runs_catalog r
  JOIN backtest_artifacts_catalog a ON r.run_id = a.run_id
  CROSS JOIN read_parquet(a.artifact_path) p
  WHERE r.run_type = 'path-only'
    AND r.status = 'completed'
    AND a.artifact_type = 'paths'
    AND r.created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY r.run_id, r.created_at
),
baseline AS (
  SELECT AVG(hit_rate_2x) as baseline_hit_rate
  FROM recent_runs
  WHERE created_at < CURRENT_DATE - INTERVAL '7 days'
)
SELECT
  r.run_id,
  r.created_at,
  r.hit_rate_2x,
  b.baseline_hit_rate,
  (r.hit_rate_2x - b.baseline_hit_rate) * 100 as delta_pct
FROM recent_runs r
CROSS JOIN baseline b
WHERE r.created_at >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY r.created_at DESC;
```

## 8. Export Results

### Export to CSV

```sql
COPY (
  SELECT
    caller_name,
    COUNT(*) as calls,
    AVG(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) as hit_rate_2x,
    AVG(peak_multiple) as avg_peak_multiple
  FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
  GROUP BY caller_name
  HAVING calls >= 10
  ORDER BY hit_rate_2x DESC
) TO 'exports/caller-analysis.csv' (HEADER, DELIMITER ',');
```

### Export to Parquet

```sql
COPY (
  SELECT *
  FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
  WHERE hit_2x = true
) TO 'exports/2x-winners.parquet' (FORMAT PARQUET);
```

## 9. Cleanup

```typescript
await catalogDb.close();
db.close();
```

## Tips

1. **Use Catalog for Discovery**: Query `backtest_runs_catalog` to find runs, then read artifacts directly
2. **Leverage Parquet Compression**: Parquet files are 5-10x smaller than JSON
3. **Filter Early**: Use WHERE clauses to reduce data scanned
4. **Aggregate in DuckDB**: DuckDB is fast at aggregations, use it instead of post-processing
5. **Cache Expensive Queries**: Save intermediate results to temp tables or Parquet files
6. **Monitor Query Performance**: Use EXPLAIN ANALYZE to understand query plans

## Next Steps

- Create custom analysis functions
- Build dashboards with visualization libraries
- Automate report generation
- Set up alerts for regressions

