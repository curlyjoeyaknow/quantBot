# Lake Export Run Slices

**Command**: `quantbot lake export-run-slices`

**Package**: `lake`

**Handler**: `packages/cli/src/handlers/lake/export-run-slices-lake.ts`

## Description

Export run-scoped slices to Parquet Lake v1 format with SHA-1 bucket partitioning, window-based slicing, and deterministic manifest generation.

## Pattern

- **Handler**: Pure function pattern (no console.log, no process.exit)
- **Service**: `LakeExporterService` wraps PythonEngine
- **Python**: Heavy lifting in `tools/backtest/lib/slice_exporter.py`

## Options

- `--run-id <id>` - Run ID (auto-generated if not provided)
- `--interval <interval>` - Candle interval (required, e.g., "1s", "5s", "1m", "5m")
- `--window <window>` - Window spec (required, e.g., "pre52_post4948")
- `--alerts <path>` - Path to alerts.parquet or alerts.csv (required)
- `--data-root <path>` - Data root directory (default: "data")
- `--chain <chain>` - Chain name (default: "solana")
- `--compression <type>` - Compression type: zstd, snappy, none (default: "zstd")
- `--target-file-mb <mb>` - Target file size in MB (default: 512)
- `--strict-coverage` - Drop slices that do not meet coverage thresholds
- `--min-required-pre <n>` - Minimum pre-candles required (default: 52)
- `--target-total <n>` - Target total candles per alert (default: 5000)
- `--format <format>` - Output format: json, table, csv (default: "table")

## Examples

```bash
# Basic export
quantbot lake export-run-slices --interval 1s --window pre52_post4948 --alerts inputs/alerts.parquet

# With strict coverage
quantbot lake export-run-slices --interval 1m --window pre10_post20 --alerts alerts.csv --strict-coverage

# Custom compression and file size
quantbot lake export-run-slices --interval 5m --window pre52_post4948 --alerts alerts.parquet --compression snappy --target-file-mb 256
```

## Architecture

```
CLI Command → Handler → LakeExporterService → PythonEngine → slice_exporter.py
                                                              ↓
                                                         ClickHouse
                                                              ↓
                                                    Parquet files (bucketed)
                                                              ↓
                                                    coverage.parquet
                                                              ↓
                                                    manifest.json (sealed)
```

## Implementation Details

- **Python Core**: Bucket partitioning (SHA-1), window slicing, config parsing
- **ClickHouse Query**: Query builder for OHLCV data
- **Parquet Write**: Bucket-partitioned writer with deterministic naming
- **Coverage Tracking**: Per-alert coverage metrics
- **Manifest Sealing**: Atomic manifest write (temp file + rename)

## Related

- [[export-slice]] - Single slice export
- [[export-slices-for-alerts]] - Alert-based slice export

