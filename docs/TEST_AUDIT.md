# Test Audit: Are Your Tests Biting?

**Date:** 2025-01-XX  
**Goal:** Verify that 90% coverage means 90% confidence, not 90% false security

## Executive Summary

Coverage tells you lines executed, not correctness asserted. This audit identifies gaps where tests exist but don't catch real bugs.

## 1. Determinism + Repro ✅/❌

### Status: ❌ **MISSING**

**Required:**

- Same Telegram fixture + same candle fixture + same strategy config → same results bit-for-bit
- No test should hit the network. Ever.
- Property/fuzz tests must log seeds and preserve minimal counterexamples

**Current State:**

- ✅ Tests use mocked network calls (axios mocked in `candles.test.ts`)
- ❌ No seed logging in property tests (`fees.property.test.ts`, `moving-averages.property.test.ts`)
- ❌ No counterexample preservation
- ❌ No deterministic fixture tests with exact expected outputs

**Action Items:**

1. Add seed logging to all `fc.assert()` calls
2. Add counterexample preservation on failure
3. Create deterministic golden fixtures (see Section 2)

---

## 2. Golden Fixtures for Simulation ❌ **CRITICAL GAP**

### Status: ❌ **MISSING**

**Required:**
You need a handful of tiny candle series where you know the answer:

- monotonic up, monotonic down, chop/whipsaw, missing candles, gappy timestamps
- expected outputs: ATH/ATL, max drawdown, per-trade outcomes, final portfolio

**Current State:**

- ❌ Tests use `mockCandles` but don't assert exact PnL values
- ❌ Tests check "it runs" not "it's right"
- ❌ No known-answer fixtures for:
  - Monotonic price movements
  - Whipsaw/chop scenarios
  - Missing candle gaps
  - Boundary timestamp alignment

**Example of Current Weak Test:**

```typescript
// packages/simulation/tests/simulate.test.ts:67
it('should execute a basic simulation with profit targets', async () => {
  const result = await simulateStrategy(mockCandles, defaultStrategy, ...);
  expect(result.finalPnl).toBeGreaterThan(0); // ❌ Too weak!
  // Should be: expect(result.finalPnl).toBeCloseTo(0.95, 2);
});
```

**Action Items:**

1. Create `packages/simulation/tests/fixtures/golden-candles.ts` with:
   - `monotonicUp`: 10 candles, price 1.0 → 2.0, expected PnL = 0.95 (with fees)
   - `monotonicDown`: 10 candles, price 2.0 → 1.0, expected PnL = -0.05 (stop loss)
   - `whipsaw`: price oscillates, expected PnL = 0.0 (break even)
   - `gappyTimestamps`: missing candles, should handle gracefully
2. Create `packages/simulation/tests/golden-fixtures.test.ts` with exact assertions

---

## 3. Idempotency as Hard Invariant ❌ **MISSING**

### Status: ❌ **MISSING**

**Required:**

- Reprocessing the same Telegram export does not duplicate alerts
- Re-ingesting the same candle batch does not duplicate candles
- Rerunning the same simulation run_id does not double-write results/events

**Current State:**

- ✅ `AlertsRepository.insertAlert()` has idempotency check by `(chatId, messageId)` (line 44-55)
- ✅ `OhlcvIngestionService` deduplicates by token_id (line 95-103)
- ❌ **No integration tests** verifying idempotency end-to-end
- ❌ No tests for simulation run_id idempotency

**Action Items:**

1. Create `packages/ingestion/tests/integration/idempotency.test.ts`:
   - Ingest same Telegram export twice → same alert count
   - Ingest same candles twice → same candle count
2. Create `packages/simulation/tests/integration/idempotency.test.ts`:
   - Run same simulation twice with same run_id → no duplicate results

---

## 4. Boundary Correctness ❌ **MISSING**

### Status: ❌ **MISSING**

**Required:**
The ugliest bugs live at boundaries:

- timestamp window inclusivity/exclusivity (off-by-one candles)
- interval alignment (1m candles aligned to minute boundaries)
- unit correctness (lamports vs SOL style mistakes, decimals/bigint)
- rounding direction in fees/slippage

**Current State:**

- ❌ No tests for timestamp window boundaries
- ❌ No tests for interval alignment
- ❌ No tests for unit conversion (lamports/SOL)
- ❌ No tests for rounding direction in fees

**Action Items:**

1. Create `packages/simulation/tests/boundaries/timestamp-windows.test.ts`:
   - Test inclusive vs exclusive boundaries
   - Test off-by-one errors in candle slicing
2. Create `packages/simulation/tests/boundaries/interval-alignment.test.ts`:
   - Test 1m candles aligned to minute boundaries
   - Test 5m candles aligned to 5-minute boundaries
3. Create `packages/simulation/tests/boundaries/unit-conversion.test.ts`:
   - Test lamports ↔ SOL conversion
   - Test decimal precision in price calculations
4. Create `packages/simulation/tests/boundaries/fee-rounding.test.ts`:
   - Test rounding direction (up vs down) in fees
   - Test slippage calculation boundaries

---

## 5. Architectural Enforcement ❌ **MISSING**

### Status: ❌ **MISSING**

**Required:**
Since you archived API + monitoring (good call), now lock the shape:

- simulation must not import storage/clients/ohlcv
- storage must not import clients
- "getCandles" should not secretly fetch from Birdeye (reads shouldn't cause bills)

**Current State:**

- ❌ **No import rule enforcement** (see `docs/ARCHITECTURE_VIOLATIONS.md`)
- ❌ Simulation still imports `@quantbot/storage` (violation)
- ❌ Simulation still has `fetchHybridCandles` with network calls (violation)
- ❌ No automated checks preventing regressions

**Action Items:**

1. Create `packages/simulation/tests/architectural/import-rules.test.ts`:
   - Use `eslint-plugin-import` or custom script to verify no forbidden imports
2. Add pre-commit hook to check architectural rules
3. Fix violations documented in `ARCHITECTURE_VIOLATIONS.md`

---

## 6. Test Bite Audit ❌ **NOT DONE**

### Status: ❌ **MISSING**

**Required:**
Pick 3 core functions:

1. Telegram mint extraction
2. Candle window slicing / ATH/ATL
3. Strategy PnL calculation

For each, deliberately introduce a small bug and confirm tests fail immediately.

**Action Items:**

1. Create `scripts/test/test-bite-audit.ts`:
   - Introduce bug in `extractSolanaAddresses()` → verify test fails
   - Introduce bug in `calculatePeriodMetricsForSimulation()` → verify test fails
   - Introduce bug in `calculateNetPnl()` → verify test fails
2. If a bug doesn't break tests, that's where you tighten assertions

---

## Test Quality Scorecard

| Category | Status | Score |
|----------|--------|-------|
| Determinism + Repro | ❌ Missing seed logging | 3/10 |
| Golden Fixtures | ❌ No known-answer tests | 2/10 |
| Idempotency | ⚠️ Code exists, no integration tests | 5/10 |
| Boundary Correctness | ❌ No boundary tests | 1/10 |
| Architectural Enforcement | ❌ No import rules | 0/10 |
| Test Bite Audit | ❌ Not done | 0/10 |

**Overall: 11/60 = 18%** — Coverage may be 90%, but confidence is low.

---

## Next Steps (Priority Order)

1. **Golden Fixtures** (highest leverage, fastest)
   - Create `golden-candles.ts` with 5 known-answer scenarios
   - Create `golden-fixtures.test.ts` with exact PnL assertions
   - This will catch PnL calculation bugs immediately

2. **Test Bite Audit** (proves tests work)
   - Run `test-bite-audit.ts` on 3 core functions
   - Fix any tests that don't catch bugs

3. **Boundary Tests** (catches off-by-one bugs)
   - Timestamp windows, interval alignment, rounding

4. **Idempotency Integration Tests** (prevents data corruption)
   - End-to-end tests for alerts, candles, simulation runs

5. **Architectural Enforcement** (prevents regressions)
   - Import rules, pre-commit hooks

---

## Files to Create

1. `packages/simulation/tests/fixtures/golden-candles.ts`
2. `packages/simulation/tests/golden-fixtures.test.ts`
3. `packages/simulation/tests/boundaries/timestamp-windows.test.ts`
4. `packages/simulation/tests/boundaries/interval-alignment.test.ts`
5. `packages/simulation/tests/boundaries/unit-conversion.test.ts`
6. `packages/simulation/tests/boundaries/fee-rounding.test.ts`
7. `packages/simulation/tests/integration/idempotency.test.ts`
8. `packages/simulation/tests/architectural/import-rules.test.ts`
9. `scripts/test/test-bite-audit.ts`
10. `packages/ingestion/tests/integration/idempotency.test.ts`
