# Dev Scripts

Quick development runners that bypass the build process for faster iteration.

## `run-calls-sweep-tsx.sh`

Run the CLI directly from TypeScript sources using `tsx` (no build required). This unblocks research even if the repo build is still red.

### Usage

```bash
bash scripts/dev/run-calls-sweep-tsx.sh <args you'd pass to quantbot>
```

**Note**: The script automatically builds core dependencies (@quantbot/core, @quantbot/utils) first - this is fast (~1-2 seconds) and required for module resolution.

### Examples

```bash
# Run a sweep
bash scripts/dev/run-calls-sweep-tsx.sh calls sweep \
  --calls-file calls.json \
  --intervals '["1m","5m"]' \
  --lags-ms '[0,10000,30000]' \
  --overlays-file overlays.json \
  --out out/sweep-001/

# Export calls first
bash scripts/dev/run-calls-sweep-tsx.sh calls export \
  --duckdb data/tele.duckdb \
  --from-iso 2024-01-01T00:00:00Z \
  --to-iso 2024-01-02T00:00:00Z \
  --out calls.json

# Evaluate single overlay set
bash scripts/dev/run-calls-sweep-tsx.sh calls evaluate \
  --calls-file calls.json \
  --overlays '[{"kind":"take_profit","takePct":100}]'

# See all available commands
bash scripts/dev/run-calls-sweep-tsx.sh --help

# See sweep command help
bash scripts/dev/run-calls-sweep-tsx.sh calls sweep --help
```

### Why This Exists

- **Unblocked iteration**: Don't let unrelated TypeScript errors hold your research hostage
- **Faster feedback**: No build step = instant execution
- **Muscle memory**: Same interface as the built CLI, just runs via tsx

### When to Use

- ✅ Running sweeps for research
- ✅ Testing new overlay combinations
- ✅ Quick validation of strategy changes
- ❌ Production deployments (use built CLI)
- ❌ CI/CD pipelines (use built CLI)

