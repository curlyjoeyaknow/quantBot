# Smart Experiment Creation

**Version**: 1.0.0  
**Date**: 2026-01-29  
**Status**: Implemented

---

## Problem

The original experiment creation workflow required explicit artifact IDs:

```bash
quantbot research experiments create \
  --name "momentum-test" \
  --alerts 88f07b79-621c-4d6b-ae39-a2c71c995703,7a1c3f29-8d45-4e2b-9f12-b3c4d5e6f789 \
  --ohlcv 3a4b5c6d-7e8f-9012-3456-789abcdef012 \
  --from 2025-05-01 \
  --to 2025-05-31
```

**Challenges**:
- Too rigid for exploratory research
- Requires knowing exact artifact IDs upfront
- Tedious for quick experimentation
- Not suitable for "filter by caller + date" workflows

---

## Solution

**Smart experiment creation** with automatic artifact selection:

```bash
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31
```

**Benefits**:
- Specify high-level intent (caller, dates, strategy)
- System automatically selects relevant artifacts
- Optional confirmation step for transparency
- Suitable for exploratory workflows

---

## How It Works

### 1. Alert Artifact Selection

**With caller filter**:
```bash
--caller whale_watcher --from 2025-05-01 --to 2025-05-31
```

Selects all alert artifacts where:
- Logical key contains `caller=whale_watcher`
- Date range overlaps `2025-05-01` to `2025-05-31`

**Without caller filter**:
```bash
--from 2025-05-01 --to 2025-05-31
```

Selects all alert artifacts where:
- Date range overlaps `2025-05-01` to `2025-05-31`
- All callers included

### 2. OHLCV Artifact Selection

Selects all OHLCV slice artifacts where:
- Date range overlaps experiment date range
- Ensures coverage for all tokens in selected alerts

### 3. Confirmation (Optional)

**With confirmation** (default):
```
Artifact Selection:
  Alerts: 15 artifacts for caller "whale_watcher" (2025-05-01 to 2025-05-31)
  OHLCV: 142 artifacts overlapping date range

Confirm artifact selection? [y/N]:
```

**Auto-confirm**:
```bash
--no-confirm  # Skip confirmation prompt
```

---

## Use Cases

### Use Case 1: Exploratory Research

**Goal**: Quickly test a strategy on a specific caller's alerts.

```bash
quantbot research experiments create-smart \
  --name "momentum-whale-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31 \
  --strategy '{"name":"momentum","threshold":0.05}' \
  --no-confirm
```

**Advantage**: No need to find artifact IDs manually.

### Use Case 2: Caller Comparison

**Goal**: Compare strategy performance across multiple callers.

```bash
for caller in whale_watcher smart_money degen_trader; do
  quantbot research experiments create-smart \
    --name "momentum-$caller" \
    --caller $caller \
    --from 2025-05-01 \
    --to 2025-05-31 \
    --no-confirm
done
```

**Advantage**: Automated batch creation for multiple callers.

### Use Case 3: Time Period Analysis

**Goal**: Test strategy across different time periods.

```bash
for month in 01 02 03 04 05; do
  quantbot research experiments create-smart \
    --name "momentum-2025-$month" \
    --from 2025-$month-01 \
    --to 2025-$month-31 \
    --no-confirm
done
```

**Advantage**: Automated batch creation for time series analysis.

### Use Case 4: Reproducible Research

**Goal**: Create experiment with exact artifact set for reproducibility.

**Step 1**: Use smart creation to find artifacts:
```bash
quantbot research experiments create-smart \
  --name "momentum-discovery" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31
# Note artifact IDs from confirmation prompt
```

**Step 2**: Create reproducible experiment with explicit IDs:
```bash
quantbot research experiments create \
  --name "momentum-reproducible" \
  --alerts <artifact-ids-from-step-1> \
  --ohlcv <artifact-ids-from-step-1> \
  --from 2025-05-01 \
  --to 2025-05-31
```

**Advantage**: Discovery + reproducibility workflow.

---

## Command Comparison

### Explicit Mode (Original)

```bash
quantbot research experiments create \
  --name "momentum-test" \
  --alerts 88f07b79-621c-4d6b-ae39-a2c71c995703 \
  --ohlcv 3a4b5c6d-7e8f-9012-3456-789abcdef012 \
  --from 2025-05-01 \
  --to 2025-05-31
```

**Pros**:
- ✅ Exact artifact control
- ✅ Fully reproducible
- ✅ No ambiguity

**Cons**:
- ❌ Requires knowing artifact IDs
- ❌ Tedious for exploration
- ❌ Not suitable for "filter by caller" workflows

**Best for**: Reproducible research, production workflows

### Smart Mode (New)

```bash
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31
```

**Pros**:
- ✅ High-level intent specification
- ✅ Automatic artifact selection
- ✅ Fast for exploration
- ✅ Suitable for "filter by caller" workflows

**Cons**:
- ⚠️ Selection logic may change over time
- ⚠️ Less explicit than artifact IDs

**Best for**: Exploratory research, quick experiments, batch creation

---

## Selection Logic

### Alert Artifacts

```typescript
// Pseudo-code
function selectAlertArtifacts(caller, from, to) {
  const artifacts = listArtifacts({ type: 'alerts_v1', status: 'active' });
  
  return artifacts.filter(a => {
    // Filter by caller (if specified)
    if (caller && !a.logicalKey.includes(`caller=${caller}`)) {
      return false;
    }
    
    // Filter by date range
    const artifactStart = new Date(a.minTs);
    const artifactEnd = new Date(a.maxTs);
    return artifactStart <= to && artifactEnd >= from;
  });
}
```

### OHLCV Artifacts

```typescript
// Pseudo-code
function selectOhlcvArtifacts(from, to) {
  const artifacts = listArtifacts({ type: 'ohlcv_slice_v2', status: 'active' });
  
  return artifacts.filter(a => {
    // Filter by date range overlap
    const artifactStart = new Date(a.minTs);
    const artifactEnd = new Date(a.maxTs);
    return artifactStart <= to && artifactEnd >= from;
  });
}
```

---

## Future Enhancements

### 1. Token-Based Selection

Select OHLCV artifacts based on tokens in alert artifacts:

```bash
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31 \
  --ohlcv-strategy token-based  # Only OHLCV for tokens in alerts
```

### 2. Coverage Validation

Validate that selected artifacts provide sufficient coverage:

```bash
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31 \
  --require-coverage 0.95  # Require 95% coverage
```

### 3. Quality Filters

Filter artifacts by quality metrics:

```bash
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31 \
  --min-quality 0.8  # Only high-quality artifacts
```

### 4. Smart Defaults

Use smart defaults based on common patterns:

```bash
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --preset recent-month  # Automatically sets date range to last month
```

---

## Best Practices

### 1. Use Smart Mode for Exploration

```bash
# Quick experimentation
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31 \
  --no-confirm
```

### 2. Use Explicit Mode for Production

```bash
# Reproducible production run
quantbot research experiments create \
  --name "momentum-prod" \
  --alerts <exact-artifact-ids> \
  --ohlcv <exact-artifact-ids> \
  --from 2025-05-01 \
  --to 2025-05-31
```

### 3. Review Selection Before Confirming

```bash
# Review selection (default behavior)
quantbot research experiments create-smart \
  --name "momentum-test" \
  --caller whale_watcher \
  --from 2025-05-01 \
  --to 2025-05-31
# Review output, then confirm
```

### 4. Document Selection Rationale

Smart creation automatically includes selection metadata:

```json
{
  "experimentId": "exp-20260129120000-abc123",
  "config": {
    "params": {
      "_selection": {
        "caller": "whale_watcher",
        "alertCount": 15,
        "ohlcvCount": 142,
        "rationale": {
          "alerts": "Selected 15 alert artifacts for caller \"whale_watcher\" within date range",
          "ohlcv": "Selected 142 OHLCV slice artifacts that overlap date range"
        }
      }
    }
  }
}
```

---

## Troubleshooting

### No Artifacts Found

**Problem**:
```
Error: No alert artifacts found for caller "whale_watcher" in date range 2025-05-01 to 2025-05-31
```

**Solutions**:
1. Check caller name spelling
2. Verify date range has data
3. List available artifacts manually:
   ```bash
   quantbot research artifacts list --type alerts_v1
   ```

### Too Many Artifacts Selected

**Problem**: Selection includes too many artifacts (slow execution).

**Solutions**:
1. Narrow date range
2. Use explicit mode with specific artifacts
3. Filter by caller (if not already)

### Unexpected Artifacts Selected

**Problem**: Selection includes unexpected artifacts.

**Solutions**:
1. Review selection with confirmation (remove `--no-confirm`)
2. Check artifact logical keys:
   ```bash
   quantbot research artifacts list --type alerts_v1 --format json
   ```
3. Use explicit mode for precise control

---

## Related Documentation

- [Research CLI Guide](./research-cli-guide.md)
- [Experiment Tracking](../architecture/experiment-tracking.md)
- [Artifact Store](../architecture/artifact-store.md)

---

## Summary

Smart experiment creation provides a flexible, high-level interface for exploratory research workflows while maintaining the option for explicit artifact control when reproducibility is critical.

**Key Points**:
- ✅ Use `create-smart` for exploration
- ✅ Use `create` for reproducibility
- ✅ Review selections before confirming
- ✅ Document selection rationale

