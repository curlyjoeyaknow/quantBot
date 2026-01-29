# Research Package CLI Guide

**Version**: 1.0.0  
**Date**: 2026-01-29  
**Status**: Complete

---

## Overview

The research package CLI provides commands for working with the artifact store and experiment tracking system. These commands enable reproducible research workflows with immutable artifacts and complete lineage tracking.

---

## Command Structure

All research package commands are under the `research` namespace:

```bash
quantbot research <subcommand> <action> [options]
```

**Subcommands**:
- `artifacts` - Artifact store operations (Parquet + SQLite manifest)
- `experiments` - Experiment tracking and execution

---

## Artifact Store Commands

### List Artifacts

List artifacts from the artifact store with optional filters.

```bash
quantbot research artifacts list [options]
```

**Options**:
- `--type <type>` - Filter by artifact type (e.g., `alerts_v1`, `ohlcv_slice_v2`)
- `--status <status>` - Filter by status (`active`, `superseded`, `tombstoned`)
- `--limit <n>` - Limit number of results (default: 100)
- `--format <format>` - Output format (`json`, `table`, `csv`) (default: `table`)

**Examples**:

```bash
# List all artifacts
quantbot research artifacts list

# List recent alerts
quantbot research artifacts list --type alerts_v1 --limit 5

# List active artifacts in JSON format
quantbot research artifacts list --status active --format json
```

**Output** (table format):

```
┌──────────────────────────────────────┬─────────────────────────────────────┬────────┐
│ artifact_id                          │ logical_key                         │ rows   │
├──────────────────────────────────────┼─────────────────────────────────────┼────────┤
│ 88f07b79-621c-4d6b-ae39-a2c71c995703 │ day=2025-05-01/chain=solana        │ 40     │
│ 7a1c3f29-8d45-4e2b-9f12-b3c4d5e6f789 │ day=2025-05-02/chain=solana        │ 35     │
└──────────────────────────────────────┴─────────────────────────────────────┴────────┘
```

---

### Get Artifact

Get a specific artifact by ID.

```bash
quantbot research artifacts get <artifact-id> [options]
```

**Arguments**:
- `<artifact-id>` - Artifact ID (UUID)

**Options**:
- `--format <format>` - Output format (`json`, `table`) (default: `table`)

**Examples**:

```bash
# Get artifact details
quantbot research artifacts get 88f07b79-621c-4d6b-ae39-a2c71c995703

# Get artifact in JSON format
quantbot research artifacts get 88f07b79-621c-4d6b-ae39-a2c71c995703 --format json
```

**Output** (table format):

```
Artifact: 88f07b79-621c-4d6b-ae39-a2c71c995703
Type: alerts_v1 (v1)
Key: day=2025-05-01/chain=solana
Status: active
Rows: 40
Created: 2026-01-27T07:04:10.779624Z
Path: /home/memez/opn/artifacts/alerts_v1/88f07b79-621c-4d6b-ae39-a2c71c995703.parquet
```

---

### Find Artifact

Find artifacts by logical key.

```bash
quantbot research artifacts find --type <type> --key <key> [options]
```

**Options**:
- `--type <type>` - Artifact type (required)
- `--key <key>` - Logical key (required)
- `--format <format>` - Output format (`json`, `table`, `csv`) (default: `table`)

**Logical Key Formats**:
- Alerts: `day=YYYY-MM-DD/chain=<chain>`
- OHLCV: `mint=<address>/from=<iso8601>/to=<iso8601>`

**Examples**:

```bash
# Find alerts for a specific day
quantbot research artifacts find --type alerts_v1 --key "day=2025-05-01/chain=solana"

# Find OHLCV slice for a token
quantbot research artifacts find --type ohlcv_slice_v2 --key "mint=ABC.../from=2025-05-01T00:00:00Z/to=2025-05-02T00:00:00Z"
```

---

### Get Lineage

Get artifact lineage (input artifacts).

```bash
quantbot research artifacts lineage <artifact-id> [options]
```

**Arguments**:
- `<artifact-id>` - Artifact ID (UUID)

**Options**:
- `--format <format>` - Output format (`json`, `table`) (default: `table`)

**Examples**:

```bash
# Get lineage for experiment results
quantbot research artifacts lineage experiment-trades-123
```

**Output** (table format):

```
Artifact: experiment-trades-123
Inputs:
  - alerts_v1: 88f07b79-621c-4d6b-ae39-a2c71c995703 (role: alerts)
  - ohlcv_slice_v2: 3a4b5c6d-7e8f-9012-3456-789abcdef012 (role: ohlcv)
```

---

### Get Downstream

Get downstream artifacts (outputs that depend on this artifact).

```bash
quantbot research artifacts downstream <artifact-id> [options]
```

**Arguments**:
- `<artifact-id>` - Artifact ID (UUID)

**Options**:
- `--format <format>` - Output format (`json`, `table`, `csv`) (default: `table`)

**Examples**:

```bash
# Find experiments that used this alert artifact
quantbot research artifacts downstream 88f07b79-621c-4d6b-ae39-a2c71c995703
```

**Output** (table format):

```
Artifact: 88f07b79-621c-4d6b-ae39-a2c71c995703
Downstream artifacts (3):
  - experiment-trades-abc123 (experiment_trades_v1)
  - experiment-trades-def456 (experiment_trades_v1)
  - experiment-metrics-ghi789 (experiment_metrics_v1)
```

---

## Experiment Commands

### Create Experiment

Create a new experiment with frozen artifact sets.

```bash
quantbot research experiments create [options]
```

**Options**:
- `--name <name>` - Experiment name (required)
- `--description <desc>` - Optional description
- `--alerts <ids...>` - Alert artifact IDs (comma-separated, required)
- `--ohlcv <ids...>` - OHLCV artifact IDs (comma-separated, required)
- `--strategies <ids...>` - Strategy artifact IDs (optional)
- `--strategy <json>` - Strategy configuration (JSON)
- `--from <date>` - Start date (ISO 8601, required)
- `--to <date>` - End date (ISO 8601, required)
- `--params <json>` - Additional parameters (JSON)
- `--format <format>` - Output format (`json`, `table`) (default: `table`)

**Examples**:

```bash
# Create simple experiment
quantbot research experiments create \
  --name "momentum-v1" \
  --alerts 88f07b79-621c-4d6b-ae39-a2c71c995703 \
  --ohlcv 3a4b5c6d-7e8f-9012-3456-789abcdef012 \
  --from 2025-05-01 \
  --to 2025-05-31

# Create experiment with strategy config
quantbot research experiments create \
  --name "momentum-v1" \
  --alerts 88f07b79-621c-4d6b-ae39-a2c71c995703 \
  --ohlcv 3a4b5c6d-7e8f-9012-3456-789abcdef012 \
  --strategy '{"name":"momentum","threshold":0.05}' \
  --from 2025-05-01 \
  --to 2025-05-31
```

**Output**:

```
Experiment created: exp-20260129120000-abc123
Status: pending
```

---

### Execute Experiment

Execute an experiment.

```bash
quantbot research experiments execute <experiment-id> [options]
```

**Arguments**:
- `<experiment-id>` - Experiment ID (required)

**Options**:
- `--format <format>` - Output format (`json`, `table`) (default: `table`)

**Examples**:

```bash
# Execute experiment
quantbot research experiments execute exp-20260129120000-abc123
```

**Output**:

```
Executing experiment exp-20260129120000-abc123...
  Building projection... done (2.3s)
  Running simulation... done (15.7s)
  Publishing results... done (1.2s)
Experiment completed: exp-20260129120000-abc123
Results:
  - trades: experiment-trades-xyz789
  - metrics: experiment-metrics-uvw456
Duration: 19.2s
```

---

### Get Experiment

Get experiment by ID.

```bash
quantbot research experiments get <experiment-id> [options]
```

**Arguments**:
- `<experiment-id>` - Experiment ID (required)

**Options**:
- `--format <format>` - Output format (`json`, `table`) (default: `table`)

**Examples**:

```bash
# Get experiment details
quantbot research experiments get exp-20260129120000-abc123
```

**Output**:

```
Experiment: exp-20260129120000-abc123
Name: momentum-v1
Status: completed
Inputs:
  - alerts: 88f07b79-621c-4d6b-ae39-a2c71c995703
  - ohlcv: 3a4b5c6d-7e8f-9012-3456-789abcdef012
Outputs:
  - trades: experiment-trades-xyz789
  - metrics: experiment-metrics-uvw456
Duration: 19.2s
```

---

### List Experiments

List experiments with optional filters.

```bash
quantbot research experiments list [options]
```

**Options**:
- `--status <status>` - Filter by status (`pending`, `running`, `completed`, `failed`, `cancelled`)
- `--git-commit <hash>` - Filter by git commit
- `--min-created <date>` - Filter by minimum creation date (ISO 8601)
- `--max-created <date>` - Filter by maximum creation date (ISO 8601)
- `--limit <n>` - Limit number of results (default: 100)
- `--format <format>` - Output format (`json`, `table`, `csv`) (default: `table`)

**Examples**:

```bash
# List all experiments
quantbot research experiments list

# List completed experiments
quantbot research experiments list --status completed --limit 10

# List experiments from specific date range
quantbot research experiments list --min-created 2025-05-01 --max-created 2025-05-31
```

---

### Find by Inputs

Find experiments by input artifact IDs.

```bash
quantbot research experiments find-by-inputs --artifacts <ids...> [options]
```

**Options**:
- `--artifacts <ids...>` - Artifact IDs to search for (comma-separated, required)
- `--format <format>` - Output format (`json`, `table`, `csv`) (default: `table`)

**Examples**:

```bash
# Find experiments that used specific artifacts
quantbot research experiments find-by-inputs --artifacts 88f07b79-621c-4d6b-ae39-a2c71c995703,3a4b5c6d-7e8f-9012-3456-789abcdef012
```

**Output**:

```
Found 2 experiments using these artifacts:
  - exp-20260129120000-abc123 (completed)
  - exp-20260129130000-def456 (pending)
```

---

## Workflows

### End-to-End Experiment Workflow

```bash
# 1. List available artifacts
quantbot research artifacts list --type alerts_v1 --limit 5
quantbot research artifacts list --type ohlcv_slice_v2 --limit 5

# 2. Create experiment
quantbot research experiments create \
  --name "momentum-test" \
  --alerts 88f07b79-621c-4d6b-ae39-a2c71c995703 \
  --ohlcv 3a4b5c6d-7e8f-9012-3456-789abcdef012 \
  --from 2025-05-01 \
  --to 2025-05-31

# 3. Execute experiment
quantbot research experiments execute exp-20260129120000-abc123

# 4. Get results
quantbot research experiments get exp-20260129120000-abc123

# 5. Check lineage
quantbot research artifacts lineage experiment-trades-xyz789
```

---

## Output Formats

### JSON Format

Machine-readable format for programmatic use.

```bash
quantbot research artifacts list --format json > artifacts.json
```

### Table Format

Human-readable format for terminal display (default).

```bash
quantbot research artifacts list --format table
```

### CSV Format

Spreadsheet-compatible format.

```bash
quantbot research artifacts list --format csv > artifacts.csv
```

---

## Error Handling

All commands follow consistent error handling:

- **Not Found**: Returns null/empty results (not an error)
- **Validation Errors**: Returns clear error messages
- **System Errors**: Returns error with context

**Example**:

```bash
$ quantbot research artifacts get nonexistent-id
Error: Artifact not found: nonexistent-id
```

---

## Best Practices

### 1. Use Artifact Lineage

Always check artifact lineage before using artifacts:

```bash
quantbot research artifacts lineage <artifact-id>
```

### 2. Verify Experiment Inputs

Before executing, verify input artifacts exist:

```bash
quantbot research artifacts get <alert-artifact-id>
quantbot research artifacts get <ohlcv-artifact-id>
```

### 3. Track Experiments

Use descriptive names and descriptions:

```bash
quantbot research experiments create \
  --name "momentum-v1-test-run-1" \
  --description "Testing momentum strategy with 0.05 threshold" \
  ...
```

### 4. Use JSON for Automation

For scripts and automation, use JSON format:

```bash
artifacts=$(quantbot research artifacts list --format json)
echo "$artifacts" | jq '.artifacts[] | .artifactId'
```

---

## Troubleshooting

### Artifact Not Found

**Problem**: `Error: Artifact not found`

**Solution**: Verify artifact ID is correct and artifact exists:

```bash
quantbot research artifacts list --format json | jq '.artifacts[] | .artifactId'
```

### Experiment Execution Failed

**Problem**: `Experiment failed: <error>`

**Solution**: Check experiment inputs and configuration:

```bash
quantbot research experiments get <experiment-id>
```

### Invalid Logical Key

**Problem**: `Error: Invalid logical key format`

**Solution**: Use correct logical key format:
- Alerts: `day=YYYY-MM-DD/chain=<chain>`
- OHLCV: `mint=<address>/from=<iso8601>/to=<iso8601>`

---

## Related Documentation

- [Research Package Architecture](../architecture/research-package-architecture.md)
- [Phase V Implementation](../../tasks/research-package/phase-5-cli-integration.md)
- [CLI Handler Pattern](./.cursor/rules/cli-handlers.mdc)

---

## Support

For issues or questions:
1. Check this guide
2. Review error messages
3. Check artifact/experiment status
4. Review lineage and provenance

