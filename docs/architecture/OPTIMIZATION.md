# Optimization Protocol

> **Validation splits, overfitting detection, and optimization safeguards**

Last updated: 2026-01-22

---

## Overview

The optimizer uses **validation splits** and **overfitting detection** to prevent selecting policies that perform well on training data but poorly on unseen data.

---

## Validation Split Strategies

### Time-Based Split (Recommended)

**Strategy:** `time_based`  
**Description:** Splits calls by timestamp (earliest → latest)

**Use Case:** Simulates real-world scenario where we optimize on historical data and validate on future data.

**Example:**
```typescript
const result = optimizePolicy({
  calls,
  candlesByCallId,
  validationSplit: {
    strategy: 'time_based',
    trainFraction: 0.8, // 80% train, 20% validation
  },
});
```

**Pros:**
- ✅ Realistic (matches production scenario)
- ✅ Prevents temporal leakage
- ✅ Tests generalization to future calls

**Cons:**
- ⚠️ Requires sufficient time range
- ⚠️ May have different caller distributions in train vs validation

---

### Caller-Based Split

**Strategy:** `caller_based`  
**Description:** Splits callers into train/validation sets

**Use Case:** Tests generalization to unseen callers.

**Example:**
```typescript
const result = optimizePolicy({
  calls,
  candlesByCallId,
  validationSplit: {
    strategy: 'caller_based',
    trainFraction: 0.8, // 80% of callers train, 20% validation
  },
});
```

**Pros:**
- ✅ Tests generalization to new callers
- ✅ Ensures validation set contains unseen callers

**Cons:**
- ⚠️ May have different time distributions in train vs validation
- ⚠️ Requires multiple callers

---

### Random Split

**Strategy:** `random`  
**Description:** Random assignment of calls to train/validation

**Use Case:** Baseline comparison with other strategies.

**Example:**
```typescript
const result = optimizePolicy({
  calls,
  candlesByCallId,
  validationSplit: {
    strategy: 'random',
    trainFraction: 0.8,
    randomSeed: 42, // For reproducibility
  },
});
```

**Pros:**
- ✅ Simple baseline
- ✅ Reproducible with seed

**Cons:**
- ⚠️ Less realistic (doesn't match production scenario)
- ⚠️ May leak temporal patterns

---

## Overfitting Detection

### How It Works

1. **Evaluate policy on train set** → Get `trainScore`
2. **Evaluate policy on validation set** → Get `validationScore`
3. **Compare scores** → Compute gap
4. **Detect overfitting** → Flag if gap exceeds thresholds

### Severity Levels

- **None:** No overfitting detected
- **Low:** Small gap (score gap > 0.1 or relative gap > 20%)
- **Medium:** Moderate gap (score gap > 0.3 or relative gap > 30%)
- **High:** Large gap (score gap > 0.5 or relative gap > 40%)

### Configuration

```typescript
const result = optimizePolicy({
  calls,
  candlesByCallId,
  validationSplit: {
    strategy: 'time_based',
    trainFraction: 0.8,
  },
  overfittingConfig: {
    lowThreshold: 0.1,        // Score gap for low severity
    mediumThreshold: 0.3,      // Score gap for medium severity
    highThreshold: 0.5,        // Score gap for high severity
    relativeThresholdPercent: 20, // Relative gap threshold (%)
    minValidationSamples: 10,   // Minimum samples to detect overfitting
  },
});
```

---

## Policy Selection

### Without Validation Split

- Selects policy with highest train score that satisfies constraints

### With Validation Split

1. **Filter:** Only policies that satisfy constraints
2. **Prefer:** Policies without overfitting (if any)
3. **Sort:** By validation score (if available), otherwise train score
4. **Select:** Best policy

**Rationale:** Validation score is a better predictor of future performance than train score.

---

## Best Practices

### 1. Always Use Validation Split

**Required for:**
- Production optimization runs
- Policy selection for caller follow plans
- Any optimization that will be used in production

**Optional for:**
- Exploratory analysis
- Quick prototyping
- Testing optimizer behavior

### 2. Use Time-Based Split for Production

Time-based split matches the production scenario (optimize on historical data, deploy to future calls).

### 3. Monitor Overfitting Metrics

**Check:**
- `overfittingMetrics.overfittingDetected` - Whether overfitting detected
- `overfittingMetrics.severity` - Severity level
- `overfittingMetrics.scoreGap` - Absolute score gap
- `overfittingMetrics.relativeGapPercent` - Relative gap (%)

**Action:**
- **Low severity:** Monitor closely, may be acceptable
- **Medium severity:** Investigate, consider different policy types
- **High severity:** Reject policy, likely overfitting

### 4. Ensure Sufficient Validation Samples

**Minimum:** 10 validation samples (configurable via `minValidationSamples`)

**Recommendation:** At least 20-30 validation samples for reliable detection.

### 5. Report Both Train and Validation Metrics

Always report:
- Train score (for comparison)
- Validation score (for production readiness)
- Overfitting metrics (for risk assessment)

---

## Example Usage

### Basic Optimization (No Validation)

```typescript
const result = optimizePolicy({
  calls,
  candlesByCallId,
  constraints: {
    maxStopOutRate: 0.3,
    maxP95DrawdownBps: -3000,
    maxTimeExposedMs: 48 * 60 * 60 * 1000,
  },
});

// Result contains:
// - bestPolicy.score (train score)
// - No validation metrics
```

### Production Optimization (With Validation)

```typescript
const result = optimizePolicy({
  calls,
  candlesByCallId,
  constraints: {
    maxStopOutRate: 0.3,
    maxP95DrawdownBps: -3000,
    maxTimeExposedMs: 48 * 60 * 60 * 1000,
  },
  validationSplit: {
    strategy: 'time_based',
    trainFraction: 0.8,
  },
  overfittingConfig: {
    lowThreshold: 0.1,
    mediumThreshold: 0.3,
    highThreshold: 0.5,
    relativeThresholdPercent: 20,
    minValidationSamples: 10,
  },
});

// Result contains:
// - bestPolicy.score (train score)
// - bestPolicy.validationScore (validation score)
// - bestPolicy.overfittingMetrics (overfitting detection)
// - result.validationSplit (split metadata)
```

### Check Overfitting

```typescript
if (result.bestPolicy?.overfittingMetrics?.overfittingDetected) {
  const severity = result.bestPolicy.overfittingMetrics.severity;
  const gap = result.bestPolicy.overfittingMetrics.scoreGap;
  
  console.warn(`Overfitting detected: ${severity} severity, gap: ${gap}`);
  
  if (severity === 'high') {
    // Reject policy
    throw new Error('Policy rejected due to high overfitting');
  }
}
```

---

## Integration with Caller Follow Plans

When generating caller follow plans:

1. **Use validation split** for optimization
2. **Check overfitting** before recommending policy
3. **Report validation metrics** in follow plan
4. **Set confidence** based on validation performance

**Example:**
```typescript
const result = optimizePolicy({
  calls: callerCalls,
  candlesByCallId,
  validationSplit: {
    strategy: 'time_based',
    trainFraction: 0.8,
  },
});

const bestPolicy = result.bestPolicy;
if (!bestPolicy) {
  // No feasible policy found
  return null;
}

// Check overfitting
if (bestPolicy.overfittingMetrics?.overfittingDetected) {
  const severity = bestPolicy.overfittingMetrics.severity;
  if (severity === 'high') {
    // Reject policy
    return null;
  }
  
  // Log warning
  logger.warn('Overfitting detected in caller follow plan', {
    caller: callerName,
    severity,
  });
}

// Use validation score for expected metrics
const expectedMetrics = {
  expectedMedianReturnBps: bestPolicy.validationScore?.metrics.medianReturnBps 
    ?? bestPolicy.score.metrics.medianReturnBps,
  // ... other metrics
};
```

---

## Related Documentation

- [Architecture Review](../reviews/ARCHITECTURE_REVIEW_2026-01-22.md) - Optimization overfitting risk
- [Policy Optimizer](../../packages/backtest/src/optimization/policy-optimizer.ts) - Implementation
- [Validation Split](../../packages/backtest/src/optimization/validation-split.ts) - Split strategies
- [Overfitting Detection](../../packages/backtest/src/optimization/overfitting-detection.ts) - Detection logic

---

_This protocol ensures policies generalize to unseen data and prevents overfitting._

