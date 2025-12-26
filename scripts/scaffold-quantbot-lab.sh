#!/usr/bin/env bash
set -euo pipefail

# QuantBot Lab scaffold
# Run from repo root: bash scripts/scaffold-quantbot-lab.sh

ROOT="$(pwd)"

mkdir -p \
  lab/presets/sim lab/presets/optimize lab/presets/rolling lab/token_sets \
  artifacts/lab \
  docs \
  packages/lab/src/{features,strategy,risk,simulation,metrics,windows,optimization} \
  packages/lab/tests \
  packages/workflows/src/{lab,features,strategy,simulation,optimization,leaderboard,windows} \
  packages/workflows/src/slices \
  packages/storage/src/{ports,adapters}/{clickhouse,duckdb} \
  packages/storage/src/adapters/clickhouse \
  packages/storage/src/adapters/duckdb \
  packages/storage/src/clickhouse/{repositories,schemas} \
  scripts

########################################
# 1) Interface Freeze Docs + Rules
########################################

cat > docs/INTERFACE_FREEZE.md <<'DOC'
# QuantBot Lab — Interface Freeze

## Rule: Only ADD, never mutate
From this point onward, ports and manifest schemas are append-only:
- ✅ Add new fields (optional preferred)
- ✅ Add new interfaces/ports
- ✅ Add new adapter implementations
- ❌ Rename fields
- ❌ Change semantics of existing fields
- ❌ Remove fields
- ❌ Change output shapes

If a breaking change is unavoidable:
- create a v2 schema/interface in a new file
- keep v1 support until migration is complete

## Frozen Contracts (initial set)
### Manifests
- Slice Manifest v1: `packages/workflows/src/slices/manifest.schema.v1.json`
- Feature Manifest v1: `packages/lab/src/features/feature.manifest.schema.v1.json`
- Simulation Summary v1: `packages/lab/src/simulation/sim.summary.schema.v1.json`

### Storage Ports
- `packages/storage/src/ports/CandleSlicePort.ts`
- `packages/storage/src/ports/FeatureComputePort.ts`
- `packages/storage/src/ports/SimulationPort.ts`
- `packages/storage/src/ports/LeaderboardPort.ts`

### Workflow APIs
- `packages/workflows/src/lab/runLabPreset.ts`
- `packages/workflows/src/lab/runRollingWindows.ts`
- `packages/workflows/src/lab/runOptimization.ts`

## Lint / CI ripwire guidance
Add CI checks that fail on:
- schema file edits (except additive)
- port signature edits (except additive optional props)

Practical approach:
- code owners for `ports/` and `*.schema.*`
- a "diff guard" script that validates changes are additive (later)
DOC

########################################
# 2) Lab Preset Examples + Token Sets
########################################

cat > lab/README.md <<'DOC'
# QuantBot Lab

- Presets live in `lab/presets/**`
- Token sets live in `lab/token_sets/**`
- Artifacts output to `artifacts/lab/**`

This repo uses:
- ClickHouse: canonical candles + leaderboards
- DuckDB: ephemeral feature computation + research execution
- Parquet: artifact boundary
DOC

cat > lab/token_sets/watchlist.txt <<'TOK'
# one token mint per line (example placeholders)
So11111111111111111111111111111111111111112
EPjFWdd5AufqSSqeM2q9wWZxkXh9eF7kZtG3ZpZf7x
TOK

cat > lab/presets/sim/momo_rsi_atr.yaml <<'YAML'
kind: sim_preset_v1
name: momo_rsi_atr
description: EMA cross + RSI filter; ATR stop; RR target.

data:
  dataset: candles_1m
  chain: sol
  interval: 1m
  time_range:
    start: 2024-10-01T00:00:00Z
    end:   2024-10-08T00:00:00Z
  tokens_file: lab/token_sets/watchlist.txt

features:
  timeframe: 1m
  groups:
    - name: trend
      indicators:
        - ema: { period: 9, source: close }
        - ema: { period: 21, source: close }
    - name: filter
      indicators:
        - rsi: { period: 14, source: close }
    - name: risk
      indicators:
        - atr: { period: 14 }

strategy:
  entries:
    - name: ema_cross_up
      when:
        all:
          - cross_up: { a: ema_9, b: ema_21 }
          - gt: { a: rsi_14, b: 52 }
  exits:
    - name: ema_cross_down
      when:
        any:
          - cross_down: { a: ema_9, b: ema_21 }

risk:
  position_size:
    mode: fixed_quote
    quote: 50

  stop_loss:
    mode: atr_multiple
    atr: atr_14
    multiple: 2.0

  take_profit:
    mode: rr_multiple
    rr: 2.0

  max_hold_minutes: 180
  allow_reentry: false
YAML

cat > lab/presets/rolling/sol_2024_q4.yaml <<'YAML'
kind: rolling_windows_v1
name: sol_2024_q4
description: 7d train, 2d test rolling through Q4 sample (example)

windows:
  - train: { start: 2024-10-01T00:00:00Z, end: 2024-10-08T00:00:00Z }
    test:  { start: 2024-10-08T00:00:00Z, end: 2024-10-10T00:00:00Z }
  - train: { start: 2024-10-03T00:00:00Z, end: 2024-10-10T00:00:00Z }
    test:  { start: 2024-10-10T00:00:00Z, end: 2024-10-12T00:00:00Z }
YAML

cat > lab/presets/optimize/momo_rsi_atr_opt.yaml <<'YAML'
kind: optimize_preset_v1
name: momo_rsi_atr_opt
base_preset: momo_rsi_atr

optimize:
  ema_fast: [5, 9, 12]
  ema_slow: [21, 34, 55]
  rsi_thresh: [50, 55, 60]
  atr_mult: [1.5, 2.0, 2.5]

search:
  mode: grid
  max_runs: 200
YAML

########################################
# 3) Storage Ports (frozen contracts)
########################################

cat > packages/storage/src/ports/CandleSlicePort.ts <<'TS'
export interface RunContext {
  runId: string;
  createdAtIso: string;
  note?: string;
}

export interface CandleSliceSpec {
  dataset: "candles_1m" | "candles_5m";
  chain: "sol" | "eth" | "base" | "bsc";
  interval: "1m" | "5m" | "1h" | "1d";
  startIso: string;
  endIso: string;
  tokenIds: string[];
}

export interface SliceExportResult {
  manifestPath: string;
  parquetPaths: string[];
  sliceHash: string;
  rowCount?: number;
}

export interface CandleSlicePort {
  exportSlice(args: { run: RunContext; spec: CandleSliceSpec; artifactDir: string }): Promise<SliceExportResult>;
}
TS

cat > packages/storage/src/ports/FeatureComputePort.ts <<'TS'
import type { RunContext } from "./CandleSlicePort";

export interface FeatureSpecV1 {
  timeframe: "1m" | "5m" | "1h" | "1d";
  groups: Array<{
    name: string;
    indicators: Array<Record<string, any>>;
  }>;
}

export interface FeatureComputeResult {
  featureSetId: string;
  featuresParquetPath: string;
  manifestPath: string;
}

export interface FeatureComputePort {
  compute(args: {
    run: RunContext;
    sliceManifestPath: string;
    sliceHash: string;
    featureSpec: FeatureSpecV1;
    artifactDir: string;
  }): Promise<FeatureComputeResult>;
}
TS

cat > packages/storage/src/ports/SimulationPort.ts <<'TS'
import type { RunContext } from "./CandleSlicePort";
import type { FeatureComputeResult } from "./FeatureComputePort";

export type ConditionTree =
  | { all: ConditionTree[] }
  | { any: ConditionTree[] }
  | { gt: { a: string; b: number | string } }
  | { lt: { a: string; b: number | string } }
  | { cross_up: { a: string; b: string } }
  | { cross_down: { a: string; b: string } };

export interface StrategySpecV1 {
  entries: Array<{ name: string; when: ConditionTree }>;
  exits: Array<{ name: string; when: ConditionTree }>;
}

export interface RiskSpecV1 {
  position_size: { mode: "fixed_quote"; quote: number };
  stop_loss:
    | { mode: "atr_multiple"; atr: string; multiple: number }
    | { mode: "trailing_percent"; percent: number }
    | { mode: "fixed_percent"; percent: number };
  take_profit:
    | { mode: "rr_multiple"; rr: number }
    | { mode: "fixed_percent"; percent: number }
    | { mode: "none" };
  max_hold_minutes?: number;
  allow_reentry?: boolean;
}

export interface SimSummaryV1 {
  runId: string;
  presetName: string;
  dataset: string;
  chain: string;
  interval: string;
  startIso: string;
  endIso: string;
  tokens: number;

  trades: number;
  pnlQuote: number;
  maxDrawdownQuote: number;
  winRate: number;

  featureSetId: string;
  configHash: string;
  windowId?: string;

  artifactDir: string;
  createdAtIso: string;
}

export interface SimulationResult {
  summary: SimSummaryV1;
  artifacts: {
    summaryJsonPath: string;
    fillsParquetPath?: string;
    positionsParquetPath?: string;
    eventsParquetPath?: string;
  };
}

export interface SimulationPort {
  run(args: {
    run: RunContext;
    presetName: string;
    windowId?: string;
    sliceManifestPath: string;
    sliceHash: string;
    features: FeatureComputeResult;
    strategy: StrategySpecV1;
    risk: RiskSpecV1;
    artifactDir: string;
  }): Promise<SimulationResult>;
}
TS

cat > packages/storage/src/ports/LeaderboardPort.ts <<'TS'
import type { RunContext } from "./CandleSlicePort";
import type { SimSummaryV1 } from "./SimulationPort";

export interface LeaderboardPort {
  ingest(args: { run: RunContext; summary: SimSummaryV1 }): Promise<void>;
}
TS

########################################
# 4) ClickHouse schemas (leaderboard)
########################################

cat > packages/storage/src/clickhouse/schemas/leaderboard.sql <<'SQL'
-- QuantBot Lab Leaderboard v1
CREATE TABLE IF NOT EXISTS strategy_leaderboard_v1 (
  strategy_id String,
  preset_name String,
  feature_set_id String,
  config_hash String,
  window_id String,
  dataset String,
  chain String,
  interval String,
  start_iso String,
  end_iso String,

  trades UInt32,
  pnl_quote Float64,
  max_drawdown_quote Float64,
  win_rate Float64,

  stability_score Float64,

  created_at DateTime
)
ENGINE = MergeTree
ORDER BY (strategy_id, created_at);

-- Optional: materialized views later (top pnl, top stability, pareto)
SQL

cat > packages/storage/src/clickhouse/repositories/LeaderboardRepository.ts <<'TS'
import type { LeaderboardPort } from "../../ports/LeaderboardPort";
import type { RunContext } from "../../ports/CandleSlicePort";
import type { SimSummaryV1 } from "../../ports/SimulationPort";

export class LeaderboardRepository implements LeaderboardPort {
  // TODO: inject ClickHouse client via composition root
  constructor(/* private readonly ch: ClickHouseClient */) {}

  async ingest(args: { run: RunContext; summary: SimSummaryV1 }): Promise<void> {
    void args;
    // TODO:
    // - INSERT INTO strategy_leaderboard_v1(...)
    // - strategy_id can be derived from preset + graph hash (later)
    throw new Error("LeaderboardRepository.ingest not implemented");
  }
}
TS

########################################
# 5) Adapters stubs (ClickHouse slice, DuckDB features, DuckDB sim)
########################################

cat > packages/storage/src/adapters/clickhouse/CandleSliceExporter.ts <<'TS'
import crypto from "node:crypto";
import type { CandleSlicePort, CandleSliceSpec, SliceExportResult, RunContext } from "../../ports/CandleSlicePort";

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export class CandleSliceExporter implements CandleSlicePort {
  // TODO: inject ClickHouse client + filesystem writer abstraction
  constructor(/* private readonly ch: ClickHouseClient */) {}

  async exportSlice(args: { run: RunContext; spec: CandleSliceSpec; artifactDir: string }): Promise<SliceExportResult> {
    void args;
    // TODO:
    // - validate schema (token_id, ts, interval join key)
    // - export Parquet(s) to artifactDir
    // - write slice.manifest.json
    // - compute sliceHash
    const sliceHash = sha("TODO");
    return {
      manifestPath: `${args.artifactDir}/slice.manifest.json`,
      parquetPaths: [`${args.artifactDir}/candles.parquet`],
      sliceHash,
    };
  }
}
TS

cat > packages/storage/src/adapters/duckdb/FeatureComputer.ts <<'TS'
import crypto from "node:crypto";
import type { FeatureComputePort, FeatureSpecV1, FeatureComputeResult } from "../../ports/FeatureComputePort";
import type { RunContext } from "../../ports/CandleSlicePort";

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export class FeatureComputer implements FeatureComputePort {
  // TODO: inject DuckDB connection factory + filesystem writer abstraction
  constructor(/* private readonly db: DuckDB */) {}

  async compute(args: {
    run: RunContext;
    sliceManifestPath: string;
    sliceHash: string;
    featureSpec: FeatureSpecV1;
    artifactDir: string;
  }): Promise<FeatureComputeResult> {
    void args;
    const featureSetId = sha(JSON.stringify(args.featureSpec));
    // TODO:
    // - load slice parquet(s) from slice manifest
    // - compute indicators via SQL templates
    // - write features.parquet + features.manifest.json
    return {
      featureSetId,
      featuresParquetPath: `${args.artifactDir}/features.parquet`,
      manifestPath: `${args.artifactDir}/features.manifest.json`,
    };
  }
}
TS

cat > packages/storage/src/adapters/duckdb/SimulationExecutor.ts <<'TS'
import crypto from "node:crypto";
import type { SimulationPort, SimulationResult, StrategySpecV1, RiskSpecV1 } from "../../ports/SimulationPort";
import type { FeatureComputeResult } from "../../ports/FeatureComputePort";
import type { RunContext } from "../../ports/CandleSlicePort";

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export class SimulationExecutor implements SimulationPort {
  // TODO: inject DuckDB or your existing simulation engine (preferred)
  constructor(/* deps */) {}

  async run(args: {
    run: RunContext;
    presetName: string;
    windowId?: string;
    sliceManifestPath: string;
    sliceHash: string;
    features: FeatureComputeResult;
    strategy: StrategySpecV1;
    risk: RiskSpecV1;
    artifactDir: string;
  }): Promise<SimulationResult> {
    void args;

    // TODO:
    // - compile strategy graph (Phase 2)
    // - run deterministic kernel (Phase 3)
    // - write artifacts (fills/positions/events) + sim.summary.json
    const configHash = sha(JSON.stringify({ strategy: args.strategy, risk: args.risk }));

    const summary = {
      runId: args.run.runId,
      presetName: args.presetName,
      dataset: "TODO",
      chain: "TODO",
      interval: "TODO",
      startIso: "TODO",
      endIso: "TODO",
      tokens: 0,
      trades: 0,
      pnlQuote: 0,
      maxDrawdownQuote: 0,
      winRate: 0,
      featureSetId: args.features.featureSetId,
      configHash,
      windowId: args.windowId,
      artifactDir: args.artifactDir,
      createdAtIso: args.run.createdAtIso,
    };

    return {
      summary,
      artifacts: {
        summaryJsonPath: `${args.artifactDir}/sim.summary.json`,
      },
    };
  }
}
TS

########################################
# 6) Lab package (@quantbot/lab) skeleton
########################################

cat > packages/lab/package.json <<'JSON'
{
  "name": "@quantbot/lab",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
JSON

cat > packages/lab/tsconfig.json <<'JSON'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
JSON

cat > packages/lab/src/index.ts <<'TS'
export * from "./features/types";
export * from "./strategy/types";
export * from "./risk/types";
export * from "./simulation/types";
export * from "./metrics/types";
export * from "./windows/types";
export * from "./optimization/types";
TS

# --- Features module
cat > packages/lab/src/features/types.ts <<'TS'
export interface FeatureManifestV1 {
  kind: "feature_manifest_v1";
  featureSetId: string;
  sliceHash: string;
  createdAtIso: string;
  featuresParquetPath: string;
  columns: string[];
}
TS

cat > packages/lab/src/features/feature.manifest.schema.v1.json <<'JSON'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "FeatureManifestV1",
  "type": "object",
  "required": ["kind", "featureSetId", "sliceHash", "createdAtIso", "featuresParquetPath", "columns"],
  "properties": {
    "kind": { "const": "feature_manifest_v1" },
    "featureSetId": { "type": "string" },
    "sliceHash": { "type": "string" },
    "createdAtIso": { "type": "string" },
    "featuresParquetPath": { "type": "string" },
    "columns": { "type": "array", "items": { "type": "string" } }
  }
}
JSON

cat > packages/lab/src/features/IndicatorRegistry.ts <<'TS'
export type IndicatorKind = "sma" | "ema" | "rsi" | "atr" | "macd" | "bband";

export interface IndicatorSpec {
  kind: IndicatorKind;
  params: Record<string, any>;
}

export interface IndicatorSqlPlan {
  columns: string[];
  sql: string;
}

/**
 * Registry maps an indicator spec -> DuckDB SQL fragment(s)
 * NOTE: keep these time-causal. No leakage.
 */
export class IndicatorRegistry {
  plan(spec: IndicatorSpec): IndicatorSqlPlan {
    void spec;
    throw new Error("IndicatorRegistry.plan not implemented");
  }
}
TS

cat > packages/lab/src/features/FeatureSetCompiler.ts <<'TS'
import crypto from "node:crypto";
import type { FeatureManifestV1 } from "./types";

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface FeatureSpecV1 {
  timeframe: "1m" | "5m" | "1h" | "1d";
  groups: Array<{ name: string; indicators: Array<Record<string, any>> }>;
}

/**
 * Phase 1.2 core: compile feature spec -> features.parquet + manifest.
 * Implementation will live in DuckDB engine adapter, but this compiles IDs + plans.
 */
export class FeatureSetCompiler {
  compileId(spec: FeatureSpecV1): string {
    return sha(JSON.stringify(spec));
  }

  buildManifest(args: {
    featureSetId: string;
    sliceHash: string;
    createdAtIso: string;
    featuresParquetPath: string;
    columns: string[];
  }): FeatureManifestV1 {
    return {
      kind: "feature_manifest_v1",
      featureSetId: args.featureSetId,
      sliceHash: args.sliceHash,
      createdAtIso: args.createdAtIso,
      featuresParquetPath: args.featuresParquetPath,
      columns: args.columns,
    };
  }
}
TS

cat > packages/lab/src/features/FeatureCache.ts <<'TS'
import crypto from "node:crypto";

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface FeatureCacheKey {
  sliceHash: string;
  featureSetId: string;
}

export function featureCacheKey(k: FeatureCacheKey): string {
  return sha(`${k.sliceHash}:${k.featureSetId}`);
}

export interface FeatureCacheHit {
  manifestPath: string;
  featuresParquetPath: string;
}

export class FeatureCache {
  constructor(private readonly baseDir: string) {}

  lookup(k: FeatureCacheKey): FeatureCacheHit | null {
    void k;
    // TODO: check filesystem paths under baseDir/cache/<hash>/
    return null;
  }

  // TODO: write-through store method
}
TS

# --- Strategy module
cat > packages/lab/src/strategy/types.ts <<'TS'
export type ConditionTree =
  | { all: ConditionTree[] }
  | { any: ConditionTree[] }
  | { gt: { a: string; b: number | string } }
  | { lt: { a: string; b: number | string } }
  | { cross_up: { a: string; b: string } }
  | { cross_down: { a: string; b: string } };

export interface StrategySpecV1 {
  entries: Array<{ name: string; when: ConditionTree }>;
  exits: Array<{ name: string; when: ConditionTree }>;
}

export interface StrategyGraphNode {
  id: string;
  kind: "gt" | "lt" | "cross_up" | "cross_down" | "all" | "any";
  inputs: string[];
  output: string;
  params?: Record<string, any>;
}

export interface StrategyGraph {
  nodes: StrategyGraphNode[];
  entryOutputs: string[];
  exitOutputs: string[];
}
TS

cat > packages/lab/src/strategy/StrategyGraphCompiler.ts <<'TS'
import crypto from "node:crypto";
import type { StrategySpecV1, StrategyGraph, ConditionTree } from "./types";

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export class StrategyGraphCompiler {
  compile(spec: StrategySpecV1): { graph: StrategyGraph; graphHash: string } {
    const nodes: StrategyGraph["nodes"] = [];

    const compileTree = (t: ConditionTree): string => {
      // TODO: compile tree to node outputs (no string lookups at runtime eventually)
      const id = sha(JSON.stringify(t)).slice(0, 12);
      nodes.push({ id, kind: "all", inputs: [], output: `b_${id}` });
      return `b_${id}`;
    };

    const entryOutputs = spec.entries.map(e => compileTree(e.when));
    const exitOutputs = spec.exits.map(e => compileTree(e.when));
    const graph: StrategyGraph = { nodes, entryOutputs, exitOutputs };
    const graphHash = sha(JSON.stringify(graph));
    return { graph, graphHash };
  }
}
TS

cat > packages/lab/src/strategy/ConditionEvaluator.ts <<'TS'
import type { StrategyGraph } from "./types";

/**
 * Phase 2: evaluate graph per (token_id, ts).
 * MVP can be row-by-row; later vectorize in DuckDB or arrow batches.
 */
export class ConditionEvaluator {
  evaluate(graph: StrategyGraph, row: Record<string, any>): Record<string, boolean> {
    void graph; void row;
    throw new Error("ConditionEvaluator.evaluate not implemented");
  }
}
TS

# --- Risk module
cat > packages/lab/src/risk/types.ts <<'TS'
export interface RiskSpecV1 {
  position_size: { mode: "fixed_quote"; quote: number };
  stop_loss:
    | { mode: "atr_multiple"; atr: string; multiple: number }
    | { mode: "trailing_percent"; percent: number }
    | { mode: "fixed_percent"; percent: number };
  take_profit:
    | { mode: "rr_multiple"; rr: number }
    | { mode: "fixed_percent"; percent: number }
    | { mode: "none" };
  max_hold_minutes?: number;
  allow_reentry?: boolean;
}
TS

cat > packages/lab/src/risk/RiskEngine.ts <<'TS'
import type { RiskSpecV1 } from "./types";

export interface RiskDecision {
  stopPrice?: number;
  takeProfitPrice?: number;
  shouldClose?: boolean;
}

export class RiskEngine {
  constructor(private readonly spec: RiskSpecV1) {}

  onEntry(args: { entryPrice: number; row: Record<string, any> }): RiskDecision {
    void args;
    // TODO: apply ATR/RR/trailing rules to initialize position constraints
    return {};
  }

  onTick(args: { entryPrice: number; currentPrice: number; row: Record<string, any>; minutesHeld: number }): RiskDecision {
    void args;
    // TODO: enforce max hold, trailing stops, etc.
    return {};
  }
}
TS

# --- Simulation module
cat > packages/lab/src/simulation/types.ts <<'TS'
export type Side = "long" | "short";

export interface FillEvent {
  tokenId: string;
  ts: string;
  side: Side;
  price: number;
  qty: number;
  reason: string;
}

export interface PositionState {
  tokenId: string;
  openTs: string;
  closeTs?: string;
  entryPrice: number;
  exitPrice?: number;
  qty: number;
  pnlQuote?: number;
}

export interface SimSummaryV1 {
  runId: string;
  presetName: string;
  dataset: string;
  chain: string;
  interval: string;
  startIso: string;
  endIso: string;
  tokens: number;

  trades: number;
  pnlQuote: number;
  maxDrawdownQuote: number;
  winRate: number;

  featureSetId: string;
  configHash: string;
  windowId?: string;

  artifactDir: string;
  createdAtIso: string;
}
TS

cat > packages/lab/src/simulation/sim.summary.schema.v1.json <<'JSON'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SimSummaryV1",
  "type": "object",
  "required": ["runId","presetName","dataset","chain","interval","startIso","endIso","tokens","trades","pnlQuote","maxDrawdownQuote","winRate","featureSetId","configHash","artifactDir","createdAtIso"],
  "properties": {
    "runId": { "type": "string" },
    "presetName": { "type": "string" },
    "dataset": { "type": "string" },
    "chain": { "type": "string" },
    "interval": { "type": "string" },
    "startIso": { "type": "string" },
    "endIso": { "type": "string" },
    "tokens": { "type": "integer" },
    "trades": { "type": "integer" },
    "pnlQuote": { "type": "number" },
    "maxDrawdownQuote": { "type": "number" },
    "winRate": { "type": "number" },
    "featureSetId": { "type": "string" },
    "configHash": { "type": "string" },
    "windowId": { "type": "string" },
    "artifactDir": { "type": "string" },
    "createdAtIso": { "type": "string" }
  }
}
JSON

cat > packages/lab/src/simulation/SimulationKernel.ts <<'TS'
import type { StrategyGraph } from "../strategy/types";
import type { RiskEngine } from "../risk/RiskEngine";
import type { FillEvent, PositionState, SimSummaryV1 } from "./types";

/**
 * Phase 3: deterministic simulation core.
 * MVP: single timeframe, long-only, market fills at close (upgrade later).
 */
export class SimulationKernel {
  run(args: {
    runId: string;
    presetName: string;
    dataset: string;
    chain: string;
    interval: string;
    startIso: string;
    endIso: string;
    tokenIds: string[];

    graph: StrategyGraph;
    risk: RiskEngine;

    // Row iterator should yield rows in chronological order per token.
    rows: AsyncIterable<Record<string, any>>;

    featureSetId: string;
    configHash: string;
    createdAtIso: string;
    artifactDir: string;
    windowId?: string;
  }): Promise<{ summary: SimSummaryV1; fills: FillEvent[]; positions: PositionState[] }> {
    void args;
    throw new Error("SimulationKernel.run not implemented");
  }
}
TS

# --- Metrics module
cat > packages/lab/src/metrics/types.ts <<'TS'
export interface Metrics {
  pnlQuote: number;
  maxDrawdownQuote: number;
  winRate: number;
  trades: number;
}
TS

cat > packages/lab/src/metrics/MetricsEngine.ts <<'TS'
import type { FillEvent, PositionState } from "../simulation/types";
import type { Metrics } from "./types";

export class MetricsEngine {
  compute(args: { fills: FillEvent[]; positions: PositionState[] }): Metrics {
    void args;
    throw new Error("MetricsEngine.compute not implemented");
  }
}
TS

cat > packages/lab/src/metrics/StabilityScorer.ts <<'TS'
export interface WindowMetricRow {
  windowId: string;
  pnlQuote: number;
  maxDrawdownQuote: number;
  trades: number;
}

export class StabilityScorer {
  score(rows: WindowMetricRow[]): { stabilityScore: number; decayScore: number; varianceScore: number } {
    void rows;
    throw new Error("StabilityScorer.score not implemented");
  }
}
TS

# --- Windows module
cat > packages/lab/src/windows/types.ts <<'TS'
export interface TimeRange {
  start: string;
  end: string;
}

export interface RollingWindow {
  train: TimeRange;
  test: TimeRange;
}
TS

cat > packages/lab/src/windows/RollingWindowExecutor.ts <<'TS'
import type { RollingWindow } from "./types";

export class RollingWindowExecutor {
  build(args: { windows: RollingWindow[] }): RollingWindow[] {
    // Later: generate from rules (trainDays/testDays/stepDays)
    return args.windows;
  }
}
TS

# --- Optimization module
cat > packages/lab/src/optimization/types.ts <<'TS'
export type SearchMode = "grid" | "random";

export interface OptimizePresetV1 {
  kind: "optimize_preset_v1";
  name: string;
  base_preset: string;
  optimize: Record<string, any[]>;
  search: { mode: SearchMode; max_runs: number };
}
TS

cat > packages/lab/src/optimization/ParameterSpace.ts <<'TS'
export interface ParameterSpace {
  dims: Record<string, any[]>;
}

export function cartesianProduct(space: ParameterSpace): Array<Record<string, any>> {
  const keys = Object.keys(space.dims);
  const out: Array<Record<string, any>> = [];

  const rec = (i: number, cur: Record<string, any>) => {
    if (i === keys.length) {
      out.push({ ...cur });
      return;
    }
    const k = keys[i];
    for (const v of space.dims[k]) {
      cur[k] = v;
      rec(i + 1, cur);
    }
  };

  rec(0, {});
  return out;
}
TS

cat > packages/lab/src/optimization/GridSearch.ts <<'TS'
import type { ParameterSpace } from "./ParameterSpace";
import { cartesianProduct } from "./ParameterSpace";

export class GridSearch {
  generate(space: ParameterSpace, maxRuns: number): Array<Record<string, any>> {
    const all = cartesianProduct(space);
    return all.slice(0, maxRuns);
  }
}
TS

cat > packages/lab/src/optimization/RandomSearch.ts <<'TS'
import type { ParameterSpace } from "./ParameterSpace";

export class RandomSearch {
  generate(space: ParameterSpace, maxRuns: number, rng: () => number = Math.random): Array<Record<string, any>> {
    const keys = Object.keys(space.dims);
    const out: Array<Record<string, any>> = [];
    for (let i = 0; i < maxRuns; i++) {
      const cfg: Record<string, any> = {};
      for (const k of keys) {
        const arr = space.dims[k];
        cfg[k] = arr[Math.floor(rng() * arr.length)];
      }
      out.push(cfg);
    }
    return out;
  }
}
TS

cat > packages/lab/src/optimization/OptimizationEngine.ts <<'TS'
import type { OptimizePresetV1 } from "./types";
import type { ParameterSpace } from "./ParameterSpace";
import { GridSearch } from "./GridSearch";
import { RandomSearch } from "./RandomSearch";

export class OptimizationEngine {
  buildCandidates(p: OptimizePresetV1): Array<Record<string, any>> {
    const space: ParameterSpace = { dims: p.optimize };
    if (p.search.mode === "grid") return new GridSearch().generate(space, p.search.max_runs);
    return new RandomSearch().generate(space, p.search.max_runs);
  }
}
TS

########################################
# 7) Workflows: lab orchestration (pure)
########################################

cat > packages/workflows/src/lab/types.ts <<'TS'
import type { FeatureSpecV1 } from "@quantbot/storage/src/ports/FeatureComputePort";
import type { StrategySpecV1, RiskSpecV1 } from "@quantbot/storage/src/ports/SimulationPort";

export interface SimPresetV1 {
  kind: "sim_preset_v1";
  name: string;
  description?: string;
  data: {
    dataset: "candles_1m" | "candles_5m";
    chain: "sol" | "eth" | "base" | "bsc";
    interval: "1m" | "5m" | "1h" | "1d";
    time_range: { start: string; end: string };
    tokens_file: string;
  };
  features: FeatureSpecV1;
  strategy: StrategySpecV1;
  risk: RiskSpecV1;
}

export interface LabPorts {
  slice: import("@quantbot/storage/src/ports/CandleSlicePort").CandleSlicePort;
  features: import("@quantbot/storage/src/ports/FeatureComputePort").FeatureComputePort;
  simulation: import("@quantbot/storage/src/ports/SimulationPort").SimulationPort;
  leaderboard: import("@quantbot/storage/src/ports/LeaderboardPort").LeaderboardPort;
}

export type RunContext = import("@quantbot/storage/src/ports/CandleSlicePort").RunContext;
TS

cat > packages/workflows/src/lab/runLabPreset.ts <<'TS'
import crypto from "node:crypto";
import type { LabPorts, RunContext, SimPresetV1 } from "./types";

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function runLabPreset(args: {
  preset: SimPresetV1;
  tokenIds: string[];
  ports: LabPorts;
  run: RunContext;
  artifactRootDir: string;
  windowId?: string;
}) {
  const artifactDir = `${args.artifactRootDir}/run_id=${args.run.runId}/preset=${args.preset.name}${args.windowId ? `/window=${args.windowId}` : ""}`;

  const slice = await args.ports.slice.exportSlice({
    run: args.run,
    artifactDir,
    spec: {
      dataset: args.preset.data.dataset,
      chain: args.preset.data.chain,
      interval: args.preset.data.interval,
      startIso: args.preset.data.time_range.start,
      endIso: args.preset.data.time_range.end,
      tokenIds: args.tokenIds,
    },
  });

  const features = await args.ports.features.compute({
    run: args.run,
    sliceManifestPath: slice.manifestPath,
    sliceHash: slice.sliceHash,
    featureSpec: args.preset.features,
    artifactDir,
  });

  const configHash = sha(JSON.stringify({ strategy: args.preset.strategy, risk: args.preset.risk }));

  const sim = await args.ports.simulation.run({
    run: args.run,
    presetName: args.preset.name,
    windowId: args.windowId,
    sliceManifestPath: slice.manifestPath,
    sliceHash: slice.sliceHash,
    features,
    strategy: args.preset.strategy,
    risk: args.preset.risk,
    artifactDir,
  });

  // attach config hash (simulation adapter may already compute)
  sim.summary.configHash = sim.summary.configHash || configHash;

  await args.ports.leaderboard.ingest({ run: args.run, summary: sim.summary });
  return sim;
}
TS

cat > packages/workflows/src/lab/runRollingWindows.ts <<'TS'
import type { LabPorts, RunContext, SimPresetV1 } from "./types";
import { runLabPreset } from "./runLabPreset";

export interface RollingWindowV1 {
  train: { start: string; end: string };
  test: { start: string; end: string };
}

export async function runRollingWindows(args: {
  preset: SimPresetV1;
  tokenIds: string[];
  windows: RollingWindowV1[];
  ports: LabPorts;
  run: RunContext;
  artifactRootDir: string;
}) {
  const results = [];
  for (let i = 0; i < args.windows.length; i++) {
    const w = args.windows[i];
    const windowId = `w${String(i).padStart(3, "0")}`;

    // MVP: backtest on test range. Train range is for later (parameter fitting / model)
    const windowPreset: SimPresetV1 = {
      ...args.preset,
      data: { ...args.preset.data, time_range: { start: w.test.start, end: w.test.end } },
    };

    results.push(
      await runLabPreset({
        preset: windowPreset,
        tokenIds: args.tokenIds,
        ports: args.ports,
        run: args.run,
        artifactRootDir: args.artifactRootDir,
        windowId,
      })
    );
  }
  return results;
}
TS

cat > packages/workflows/src/lab/runOptimization.ts <<'TS'
import type { LabPorts, RunContext, SimPresetV1 } from "./types";
import { OptimizationEngine } from "@quantbot/lab/src/optimization/OptimizationEngine";
import type { OptimizePresetV1 } from "@quantbot/lab/src/optimization/types";
import { runLabPreset } from "./runLabPreset";

/**
 * MVP optimization runner:
 * - generates candidate param configs
 * - for each candidate, derive a preset variant
 * - run lab preset
 * - leaderboard ingests results
 */
export async function runOptimization(args: {
  basePreset: SimPresetV1;
  optimizePreset: OptimizePresetV1;
  tokenIds: string[];
  ports: LabPorts;
  run: RunContext;
  artifactRootDir: string;
}) {
  const engine = new OptimizationEngine();
  const candidates = engine.buildCandidates(args.optimizePreset);

  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    const params = candidates[i];

    // TODO: apply params into basePreset (feature periods, thresholds, risk multipliers).
    // For now: just stamp variant name.
    const variant: SimPresetV1 = {
      ...args.basePreset,
      name: `${args.basePreset.name}__opt_${String(i).padStart(4, "0")}`,
      description: `opt params=${JSON.stringify(params)}`,
    };

    results.push(
      await runLabPreset({
        preset: variant,
        tokenIds: args.tokenIds,
        ports: args.ports,
        run: args.run,
        artifactRootDir: args.artifactRootDir,
      })
    );
  }

  return results;
}
TS

########################################
# 8) Slice manifest schema (workflow side)
########################################

cat > packages/workflows/src/slices/manifest.schema.v1.json <<'JSON'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SliceManifestV1",
  "type": "object",
  "required": ["kind","dataset","chain","interval","startIso","endIso","tokenCount","files","schemaHash","sliceHash","createdAtIso"],
  "properties": {
    "kind": { "const": "slice_manifest_v1" },
    "dataset": { "type": "string" },
    "chain": { "type": "string" },
    "interval": { "type": "string" },
    "startIso": { "type": "string" },
    "endIso": { "type": "string" },
    "tokenCount": { "type": "integer" },
    "files": { "type": "array", "items": { "type": "string" } },
    "schemaHash": { "type": "string" },
    "sliceHash": { "type": "string" },
    "createdAtIso": { "type": "string" }
  }
}
JSON

########################################
# 9) Lab runner entrypoints (thin scripts)
########################################

cat > scripts/lab-sim.ts <<'TS'
/**
 * Thin lab runner entrypoint.
 * This calls into workflows; your wiring lives in scripts/lab-sim.wiring.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

let YAML: any;
try { YAML = require("yaml"); } catch { YAML = null; }

type SimPresetV1 = import("@quantbot/workflows/src/lab/types").SimPresetV1;

function die(msg: string): never { console.error(msg); process.exit(1); }
function sha(s: string): string { return crypto.createHash("sha256").update(s).digest("hex"); }

function listPresets(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map(f => path.join(dir, f))
    .sort();
}

function loadYaml<T>(p: string): T {
  if (!YAML) die("Missing 'yaml' devDependency. Install: pnpm add -D yaml");
  return YAML.parse(fs.readFileSync(p, "utf8")) as T;
}

function readTokens(p: string): string[] {
  if (!fs.existsSync(p)) die(`tokens_file missing: ${p}`);
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !s.startsWith("#"));
}

async function main() {
  const cmd = process.argv[2] ?? "list";
  const presetDir = "lab/presets/sim";

  const files = listPresets(presetDir);
  if (files.length === 0) die(`No presets found in ${presetDir}`);

  const presets = files.map(f => loadYaml<SimPresetV1>(f));
  const byName = new Map(presets.map(p => [p.name, p] as const));

  if (cmd === "list") {
    console.log(`Presets:`);
    for (const p of presets) console.log(`- ${p.name}${p.description ? ` — ${p.description}` : ""}`);
    return;
  }

  if (cmd !== "run") die(`Usage: pnpm lab:sim list | run <presetName...>`);

  const names = process.argv.slice(3);
  if (names.length === 0) die("No presets selected.");

  const selected: SimPresetV1[] = names.map(n => {
    const p = byName.get(n);
    if (!p) die(`Unknown preset: ${n}`);
    return p;
  });

  const runId = `lab_${sha(JSON.stringify({ t: new Date().toISOString(), presets: names })).slice(0, 12)}`;
  const createdAtIso = new Date().toISOString();

  const tokenSets: Record<string, string[]> = {};
  for (const p of selected) tokenSets[p.data.tokens_file] = readTokens(p.data.tokens_file);

  const { runSelectedPresets } = await import("./lab-sim.wiring");
  const res = await runSelectedPresets({
    runId,
    createdAtIso,
    presets: selected,
    tokenSets,
    artifactRootDir: "artifacts/lab",
  });

  console.log("\n=== RESULTS (pnl desc) ===");
  const sorted = [...res].sort((a, b) => (b.summary.pnlQuote ?? 0) - (a.summary.pnlQuote ?? 0));
  for (const r of sorted) {
    console.log(`${r.summary.presetName.padEnd(28)} pnl=${String(r.summary.pnlQuote).padEnd(10)} dd=${String(r.summary.maxDrawdownQuote).padEnd(10)} trades=${r.summary.trades}`);
  }
}

main().catch(e => { console.error(e?.stack || String(e)); process.exit(1); });
TS

cat > scripts/lab-sim.wiring.ts <<'TS'
/**
 * Wiring: instantiate ports/adapters here.
 * Keep workflows pure; keep the rest of the repo sane.
 */
import type { SimPresetV1, LabPorts } from "@quantbot/workflows/src/lab/types";
import type { RunContext } from "@quantbot/storage/src/ports/CandleSlicePort";
import { runLabPreset } from "@quantbot/workflows/src/lab/runLabPreset";

// Adapters (stubs for now)
import { CandleSliceExporter } from "@quantbot/storage/src/adapters/clickhouse/CandleSliceExporter";
import { FeatureComputer } from "@quantbot/storage/src/adapters/duckdb/FeatureComputer";
import { SimulationExecutor } from "@quantbot/storage/src/adapters/duckdb/SimulationExecutor";
import { LeaderboardRepository } from "@quantbot/storage/src/clickhouse/repositories/LeaderboardRepository";

export async function runSelectedPresets(args: {
  runId: string;
  createdAtIso: string;
  presets: SimPresetV1[];
  tokenSets: Record<string, string[]>;
  artifactRootDir: string;
}) {
  const run: RunContext = { runId: args.runId, createdAtIso: args.createdAtIso };

  // TODO: wire real clients in composition root (ClickHouse client, DuckDB db handle)
  const ports: LabPorts = {
    slice: new CandleSliceExporter(),
    features: new FeatureComputer(),
    simulation: new SimulationExecutor(),
    leaderboard: new LeaderboardRepository(),
  } as any;

  const results = [];
  for (const preset of args.presets) {
    const tokenIds = args.tokenSets[preset.data.tokens_file] ?? [];
    results.push(
      await runLabPreset({
        preset,
        tokenIds,
        ports,
        run,
        artifactRootDir: args.artifactRootDir,
      })
    );
  }

  return results;
}
TS

########################################
# 10) Placeholder tests
########################################

cat > packages/lab/tests/smoke.test.ts <<'TS'
import { describe, it, expect } from "vitest";

describe("lab scaffold", () => {
  it("loads", () => {
    expect(true).toBe(true);
  });
});
TS

chmod +x scripts/scaffold-quantbot-lab.sh || true
echo "✅ QuantBot Lab scaffold created."
echo "Next: wire real ClickHouse + DuckDB clients into scripts/lab-sim.wiring.ts and implement ports phase-by-phase."
