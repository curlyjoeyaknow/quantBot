# Module Architecture Design

This document defines the modular structure for the refactored codebase.

## Directory Structure

```
src/
├── simulation/           # Core simulation engine (partially done)
│   ├── engine.ts        # SimulationEngine class (done)
│   ├── config.ts        # Config schemas (done)
│   ├── index.ts         # Public API (done)
│   ├── candles.ts       # Candle utilities (done)
│   ├── indicators.ts    # Technical indicators (done)
│   ├── ichimoku.ts      # Ichimoku calculations (done)
│   ├── target-resolver.ts # Target resolution (done)
│   ├── sinks.ts         # Output sinks (done)
│   ├── strategies/      # Strategy definitions (NEW)
│   │   ├── types.ts     # Strategy type definitions
│   │   ├── builder.ts   # StrategyBuilder class
│   │   ├── validator.ts # Strategy validation
│   │   └── presets.ts   # Strategy presets
│   ├── optimization/    # Strategy optimization (NEW)
│   │   ├── optimizer.ts # StrategyOptimizer class
│   │   ├── grid.ts      # Parameter grid generation
│   │   ├── types.ts     # Optimization result types
│   │   └── ml-optimizer.ts # ML-based optimization
│   └── caller-simulator.ts # Caller-specific simulation (NEW)
│
├── data/                # Data access layer (NEW)
│   ├── loaders/         # Data loaders
│   │   ├── csv-loader.ts      # CSV file loader
│   │   ├── clickhouse-loader.ts # ClickHouse loader
│   │   ├── caller-loader.ts    # Caller data loader
│   │   └── index.ts           # Loader factory
│   ├── processors/      # Data transformation
│   │   ├── csv-processor.ts    # CSV parsing/processing
│   │   ├── data-deduplicator.ts # Deduplication logic
│   │   └── data-validator.ts   # Data validation
│   └── validators/      # Data validation
│       └── data-validator.ts   # Validation utilities
│
├── analysis/            # Analysis and metrics (NEW)
│   ├── result-analyzer.ts     # Main analyzer class
│   ├── metrics/               # Metrics calculation
│   │   ├── pnl-metrics.ts     # PnL calculations
│   │   ├── risk-metrics.ts    # Risk metrics (Sharpe, drawdown)
│   │   ├── trade-metrics.ts   # Trade statistics
│   │   └── portfolio-metrics.ts # Portfolio-level metrics
│   ├── aggregators/           # Result aggregation
│   │   ├── result-aggregator.ts # Main aggregator
│   │   └── strategy-aggregator.ts # Strategy-specific aggregation
│   └── comparators/           # Strategy comparison
│       └── strategy-comparator.ts # Compare strategies
│
└── reporting/          # Report generation (NEW)
    ├── report-generator.ts    # Base report generator
    ├── formats/               # Output formats
    │   ├── csv-reporter.ts    # CSV reports
    │   ├── json-reporter.ts   # JSON reports
    │   ├── html-reporter.ts   # HTML/email reports
    │   └── markdown-reporter.ts # Markdown reports
    └── templates/             # Report templates
        ├── email-template.html
        └── dashboard-template.html
```

## Module Interfaces

### 1. Data Loaders

#### `DataLoader` Interface
```typescript
interface DataLoader {
  load(params: LoadParams): Promise<LoadResult[]>;
  canLoad(source: string): boolean;
}
```

#### Implementations
- **CsvDataLoader**: Loads data from CSV files
- **ClickHouseDataLoader**: Loads data from ClickHouse
- **CallerDataLoader**: Loads caller-specific data

### 2. Strategy Builders

#### `StrategyBuilder` Interface
```typescript
interface StrategyBuilder {
  build(config: StrategyConfig): Strategy[];
  validate(config: StrategyConfig): ValidationResult;
  getPreset(name: string): StrategyConfig | null;
}
```

### 3. Result Analyzers

#### `ResultAnalyzer` Interface
```typescript
interface ResultAnalyzer {
  analyze(results: SimulationResult[]): AnalysisResult;
  calculateMetrics(results: SimulationResult[]): Metrics;
  compare(strategies: StrategyResult[]): ComparisonResult;
}
```

### 4. Report Generators

#### `ReportGenerator` Interface
```typescript
interface ReportGenerator {
  generate(data: ReportData, format: ReportFormat): Promise<string>;
  supports(format: ReportFormat): boolean;
}
```

## Module Dependencies

```
simulation/
  ├── depends on: data/loaders, analysis/metrics
  └── used by: scripts/simulation/, scripts/optimization/

data/
  ├── depends on: (external: csv-parse, clickhouse-client)
  └── used by: simulation/, analysis/, reporting/

analysis/
  ├── depends on: simulation/
  └── used by: scripts/analysis/, reporting/

reporting/
  ├── depends on: analysis/, data/
  └── used by: scripts/reporting/
```

## Configuration Schema Extensions

### Optimization Config
```typescript
interface OptimizationConfig {
  name: string;
  baseStrategy: StrategyConfig;
  parameterGrid: {
    profitTargets: Array<Array<{target: number, percent: number}>>;
    trailingStopPercent: number[];
    trailingStopActivation: number[];
    minExitPrice: number[];
  };
  data: DataSelectionConfig;
  outputs: OutputTargetConfig[];
  maxConcurrent?: number;
}
```

### Analysis Config
```typescript
interface AnalysisConfig {
  name: string;
  input: {
    type: 'csv' | 'json' | 'clickhouse';
    path?: string;
    query?: string;
  };
  metrics: {
    pnl: boolean;
    risk: boolean;
    trade: boolean;
    portfolio: boolean;
  };
  comparisons?: {
    groupBy: string[];
    sortBy: string;
  };
  outputs: OutputTargetConfig[];
}
```

### Reporting Config
```typescript
interface ReportingConfig {
  name: string;
  input: {
    type: 'csv' | 'json' | 'clickhouse';
    path?: string;
  };
  template: {
    type: 'email' | 'dashboard' | 'summary';
    path?: string;
  };
  format: 'html' | 'markdown' | 'csv' | 'json';
  outputs: OutputTargetConfig[];
}
```

## Migration Path

### Phase 1: Extract Common Patterns
1. Create `data/loaders/csv-loader.ts` - Extract CSV loading
2. Create `data/processors/csv-processor.ts` - Extract CSV processing
3. Create `analysis/metrics/` - Extract metrics calculation
4. Create `reporting/formats/csv-reporter.ts` - Extract CSV writing

### Phase 2: Build Strategy Module
1. Create `simulation/strategies/types.ts` - Strategy types
2. Create `simulation/strategies/builder.ts` - Strategy builder
3. Create `simulation/strategies/presets.ts` - Strategy presets
4. Migrate strategies from `analyze-solana-callers-optimized.ts`

### Phase 3: Build Optimization Module
1. Create `simulation/optimization/optimizer.ts` - Main optimizer
2. Create `simulation/optimization/grid.ts` - Parameter grids
3. Migrate `optimize-strategies.ts` logic

### Phase 4: Build Analysis Module
1. Create `analysis/result-analyzer.ts` - Main analyzer
2. Create `analysis/aggregators/` - Aggregation logic
3. Migrate analysis scripts

### Phase 5: Build Reporting Module
1. Create `reporting/report-generator.ts` - Base generator
2. Create `reporting/formats/` - Format implementations
3. Migrate reporting scripts

## Benefits

1. **Reusability**: Common patterns extracted into reusable modules
2. **Testability**: Each module can be tested independently
3. **Maintainability**: Changes in one place affect all consumers
4. **Configurability**: Config-driven approach reduces code duplication
5. **Extensibility**: Easy to add new loaders, analyzers, reporters

