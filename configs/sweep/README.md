# Sweep Config Examples

This directory contains example configuration files for `quantbot calls sweep`.

## Quick Start

### 1. Prepare your data files

Create or export your data files:

```bash
# Export calls from DuckDB
quantbot calls export \
  --duckdb data/tele.duckdb \
  --from-iso 2024-01-01T00:00:00Z \
  --to-iso 2024-12-01T00:00:00Z \
  --out calls.json

# Create an overlays file (or use existing)
cat > overlays.json <<EOF
[
  {
    "id": "set-1",
    "overlays": [
      { "kind": "take_profit", "takePct": 100 },
      { "kind": "stop_loss", "stopPct": 20 }
    ]
  }
]
EOF
```

### 2. Create your sweep config

Copy one of the examples:

```bash
cp configs/sweep/sweep-basic.yaml my-sweep.yaml
```

Edit paths to match your data files:

```yaml
# my-sweep.yaml
callsFile: calls.json              # Or absolute path: /path/to/calls.json
overlaySetsFile: overlays.json     # Or absolute path: /path/to/overlays.json
out: out/my-sweep                  # Output directory

intervals:
  - 1m
  - 5m

lagsMs:
  - 0
  - 10000
```

### 3. Run the sweep

```bash
quantbot calls sweep --config my-sweep.yaml
```

## Config Files

- **`sweep-basic.yaml`** - Minimal example with 6 scenarios (3 intervals × 2 lags)
- **`sweep-full.yaml`** - All options documented with comments
- **`sweep-grid-search.json`** - Large grid search with 45 scenarios

## Path Resolution

**Relative paths** in config files are resolved relative to your **current working directory** (where you run the command from), not relative to the config file location.

**Examples:**

```yaml
# If you run from /home/user/quantBot/
callsFile: calls.json              # Looks for /home/user/quantBot/calls.json
callsFile: data/calls.json         # Looks for /home/user/quantBot/data/calls.json
callsFile: /abs/path/calls.json    # Absolute path (recommended)
```

**Recommendation:** Use absolute paths in config files for clarity:

```yaml
callsFile: /home/user/quantBot/data/calls.json
overlaySetsFile: /home/user/quantBot/configs/overlays.json
out: /home/user/quantBot/out/my-sweep
```

## CLI Overrides

You can override any config value from the command line:

```bash
# Override taker fee
quantbot calls sweep --config sweep-basic.yaml --takerFeeBps 50

# Override output directory
quantbot calls sweep --config sweep-basic.yaml --out out/custom-sweep

# Add more intervals (merges with config)
quantbot calls sweep --config sweep-basic.yaml --intervals '["1m","5m","15m","1h"]'
```

## Resume Support

If your sweep is interrupted, you can resume from where it left off:

```bash
quantbot calls sweep --config my-sweep.yaml --resume
```

This will:
- Read `out/my-sweep/run.meta.json`
- Find which scenarios completed
- Skip completed scenarios
- Continue from the next scenario

## Output Files

Every sweep run creates these files in the output directory:

- `per_call.jsonl` - One row per call × overlay × lag × interval
- `per_caller.jsonl` - Aggregated by caller per configuration
- `matrix.json` - Aggregated by caller × lag × interval × overlaySet
- `errors.jsonl` - All errors for debugging
- `run.meta.json` - Git sha, config hash, timings, counts, completed scenarios
- `config.json` - Copy of your config (for reproducibility)

## Troubleshooting

### Error: "callsFile is required"

Make sure your config file includes all required fields:
- `callsFile`
- `intervals`
- `lagsMs`
- `out`
- `overlaySetsFile` or `overlaysFile`

### Error: "Failed to load calls from ..."

Check that the file path in your config is correct:

```bash
# If using relative path, run from the correct directory
cd /path/to/quantBot
quantbot calls sweep --config my-sweep.yaml

# Or use absolute paths in your config
```

### Error: "Failed to load overlays from ..."

Make sure your overlays file is valid JSON:

```json
[
  {
    "id": "set-1",
    "overlays": [
      { "kind": "take_profit", "takePct": 100 }
    ]
  }
]
```

## Example Workflow

```bash
# 1. Export calls
quantbot calls export \
  --duckdb data/tele.duckdb \
  --from-iso 2024-01-01T00:00:00Z \
  --to-iso 2024-12-01T00:00:00Z \
  --out data/calls.json

# 2. Create sweep config
cat > my-sweep.yaml <<EOF
callsFile: data/calls.json
overlaySetsFile: configs/overlays.json
out: out/sweep-$(date +%Y%m%d-%H%M%S)
intervals: [1m, 5m, 1h]
lagsMs: [0, 10000, 30000, 60000]
EOF

# 3. Run sweep
quantbot calls sweep --config my-sweep.yaml

# 4. Analyze results
ls out/sweep-*/
cat out/sweep-*/run.meta.json
head out/sweep-*/per_call.jsonl
```

