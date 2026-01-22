# Phase A: Data Quality Gates - Implementation

**Date**: 2026-01-21  
**Status**: ✅ Foundation Complete  
**Addresses**: Risk #2 from ARCHITECTURE_REVIEW_2026-01-21.md

---

## ✅ What's Implemented

### 1. Quality Gate Module
- **File**: `packages/backtest/src/quality-gates.ts`
- **Functions**:
  - `enforceCoverageGate()` - Enforce minimum coverage (default 95%)
  - `enforceQualityGate()` - Enforce minimum quality score (default 80)
  - `enforceAllQualityGates()` - Enforce all gates
  - `calculateQualityMetrics()` - Calculate quality from candle data
- **Error**: `QualityGateError` - Thrown when gates fail

### 2. Hard Failure on Zero Eligible Calls
- **File**: `packages/backtest/src/runPathOnly.ts` (line 116)
- **Change**: Now throws error instead of returning empty result
- **Impact**: Backtest fails immediately if no calls pass coverage check

---

## 🎯 Quality Thresholds

### Coverage Threshold
- **Default**: 95% (0.95)
- **Meaning**: At least 95% of expected candles must be present
- **Enforcement**: HARD FAIL if below threshold
- **Override**: Set `minCoverageThreshold` in config

### Quality Score Threshold
- **Default**: 80 (out of 100)
- **Calculation**:
  - Start at 100 points
  - Deduct for gaps: -5 points per 1% gap rate
  - Deduct for duplicates: -10 points per 1% duplicate rate
  - Deduct for distortions: -20 points per distortion
- **Enforcement**: HARD FAIL if below threshold
- **Override**: Set `minQualityScore` in config

---

## 📊 Quality Metrics

```typescript
interface QualityMetrics {
  coverage: number;        // 0.0 to 1.0 (ratio of actual/expected candles)
  qualityScore: number;    // 0 to 100 (composite quality score)
  candleCount: number;     // Actual candles present
  expectedCandles: number; // Expected candles for time range
  gaps: number;            // Missing candles (gaps in sequence)
  duplicates: number;      // Duplicate candles (same timestamp)
  distortions: number;     // OHLC violations (high < low, etc.)
}
```

---

## 🚨 Error Handling

### QualityGateError
Thrown when quality gates fail:

```typescript
try {
  enforceAllQualityGates(metrics, {
    minCoverageThreshold: 0.95,
    minQualityScore: 80,
    enforceGates: true
  });
} catch (error) {
  if (error instanceof QualityGateError) {
    console.error('Quality gate failed:', error.message);
    console.error('Metrics:', error.metrics);
    console.error('Threshold:', error.threshold);
    // Handle gracefully or fail
  }
}
```

---

## 🔧 Usage

### In Backtest Runner

```typescript
import { enforceAllQualityGates, calculateQualityMetrics } from './quality-gates.js';

// After loading candles
const metrics = calculateQualityMetrics(
  candles.length,
  expectedCandles,
  gaps,
  duplicates,
  distortions
);

// Enforce gates (throws if fails)
enforceAllQualityGates(metrics, {
  minCoverageThreshold: 0.95,
  minQualityScore: 80,
  enforceGates: true // Set to false to warn only
});
```

### In Coverage Check

```typescript
// runPathOnly.ts now fails hard if no eligible calls
if (coverage.eligible.length === 0) {
  throw new Error('No eligible calls - insufficient data quality');
}
```

---

## 🎯 Acceptance Criteria

From architecture review Phase A:

- [x] Add `minCoverageThreshold` (default 95%) ✅
- [x] Fail hard if coverage < threshold ✅
- [x] Add `minQualityScore` (default 80) ✅
- [ ] Mandatory deduplication before backtest (TODO)
- [ ] Document in `docs/architecture/DATA_QUALITY_GATES.md` (this file)

---

## ⚠️ Known Limitations

1. **Quality calculation is simplified** - Full implementation should use `tools/backtest/lib/slice_quality.py`
2. **Deduplication not mandatory yet** - Still optional
3. **No ClickHouse integration** - Only works with DuckDB/Parquet slices
4. **No per-token quality tracking** - Global metrics only

---

## 📈 Impact

### Before
- Coverage checks returned `eligible: boolean` (soft check)
- Backtests could run on 50% coverage data
- No quality score enforcement
- Silent failure mode (no error, just bad results)

### After
- Coverage checks throw error if < 95% (hard check)
- Backtests fail immediately on insufficient data
- Quality score enforced (default 80)
- Loud failure mode (error with metrics)

### Risk Reduction
- **Risk #2** (Data Quality Gates): **HIGH → MEDIUM**
- Still need: Mandatory deduplication, per-token tracking, ClickHouse integration

---

## 🔗 References

- Architecture Review: `docs/reviews/ARCHITECTURE_REVIEW_2026-01-21.md`
- Risk #2: "Data quality gates are advisory, not enforced"
- Phase A: Foundations (Week 3-4)

---

**Status**: Foundation complete  
**Next**: Add mandatory deduplication, per-token quality tracking

