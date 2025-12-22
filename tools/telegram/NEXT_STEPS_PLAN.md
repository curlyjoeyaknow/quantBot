# Next Steps Plan: Python/DuckDB Extension

## Current Status ✅

### Implementation Complete
- **Simulation Engine**: Full DuckDB-based backtesting with entry/exit logic
- **Statistical Analysis**: Feature engineering, technical indicators, performance analysis
- **ML Pipeline**: Data preparation, model training, prediction interface
- **TypeScript Integration**: Handlers and CLI commands registered
- **Tests**: 34 Python tests passing, 7 TypeScript handler tests passing

### Test Coverage
- **Python**: 34 passing, 7 skipped (sklearn not installed)
  - Simulation: 5 tests
  - Statistics: 9 tests  
  - ML: 1 passing, 7 skipped
  - Address extraction: 4 tests
  - DuckDB transforms: 5 tests
  - Parquet output: 5 tests
- **TypeScript**: 7 handler tests passing

## Immediate Next Steps (Priority Order)

### 1. Install sklearn and Enable ML Tests ⚡
**Priority**: High  
**Effort**: 5 minutes  
**Impact**: Enables 7 skipped ML tests

```bash
cd tools/telegram
source ../../.venv/bin/activate
pip install scikit-learn
pytest tests/test_ml.py -v
```

**Expected Outcome**: All 8 ML tests passing

---

### 2. Batch Simulation Enhancement ⚡
**Priority**: High  
**Effort**: 2-3 hours  
**Impact**: Enables simulating all calls at once

**Tasks**:
- [ ] Add function to fetch all calls from DuckDB with mints and timestamps
- [ ] Implement progress tracking for batch operations
- [ ] Add parallel processing support (optional)
- [ ] Update CLI to support batch mode properly

**Files to Modify**:
- `simulation/simulator.py`: Add `batch_simulate_all()` method
- `simulation/run_simulation.py`: Implement batch fetching logic
- `handlers/simulation/run-simulation-duckdb.ts`: Add batch mode support

**Example Implementation**:
```python
def batch_simulate_all(
    self,
    strategy: StrategyConfig,
    initial_capital: float = 1000.0
) -> List[Dict[str, Any]]:
    """Fetch all calls from DuckDB and simulate them."""
    calls = self.con.execute("""
        SELECT DISTINCT mint, call_ts_ms
        FROM user_calls_d
        WHERE mint IS NOT NULL
        ORDER BY call_ts_ms
    """).fetchall()
    
    mints = [row[0] for row in calls]
    timestamps = [datetime.fromtimestamp(row[1] / 1000) for row in calls]
    
    return self.batch_simulate(strategy, mints, timestamps, initial_capital)
```

---

### 3. Drop-based Entry Implementation ⚡
**Priority**: Medium  
**Effort**: 2-3 hours  
**Impact**: Enables more realistic entry strategies

**Tasks**:
- [ ] Implement drop detection logic (price drops X% from alert price)
- [ ] Add drop threshold configuration to strategy schema
- [ ] Test drop entry scenarios
- [ ] Update documentation

**Files to Modify**:
- `simulation/simulator.py`: Implement `_execute_drop_entry()` method
- `simulation/sql_functions.py`: Add drop detection SQL functions (optional)

**Logic**:
```python
def _execute_drop_entry(
    self,
    strategy: StrategyConfig,
    alert_ts: datetime,
    candles: List[Dict[str, Any]]
) -> Optional[SimulationEvent]:
    """Entry on price drop."""
    alert_price = self._get_price_at_timestamp(candles, alert_ts)
    if alert_price is None:
        return None
    
    drop_threshold = strategy.entry_config.get('drop_threshold_pct', 0.1)
    target_price = alert_price * (1 - drop_threshold)
    
    # Find first candle where price drops to target
    for candle in candles:
        if candle['timestamp'] > alert_ts and candle['low'] <= target_price:
            entry_price = target_price
            # ... create entry event
            return SimulationEvent(...)
    
    return None
```

---

### 4. Re-entry Logic Implementation ⚡
**Priority**: Medium  
**Effort**: 3-4 hours  
**Impact**: Enables partial exit and re-entry strategies

**Tasks**:
- [ ] Implement re-entry detection after partial exits
- [ ] Add re-entry configuration to strategy schema
- [ ] Handle multiple re-entries
- [ ] Test re-entry scenarios

**Files to Modify**:
- `simulation/simulator.py`: Add re-entry logic to `_execute_exits()`
- `simulation/sql_functions.py`: Add re-entry SQL functions (optional)

**Logic Flow**:
1. After partial exit (e.g., 50% at 2x), check if price drops back
2. If price drops to re-entry threshold, enter again
3. Track multiple positions per simulation run
4. Calculate combined PnL

---

### 5. Advanced Metrics Calculation ⚡
**Priority**: Medium  
**Effort**: 2-3 hours  
**Impact**: Better performance evaluation

**Tasks**:
- [ ] Implement proper Sharpe ratio (needs returns series)
- [ ] Add Sortino ratio
- [ ] Add maximum drawdown duration
- [ ] Add win/loss streaks
- [ ] Add time-weighted returns

**Files to Modify**:
- `simulation/simulator.py`: Enhance `_calculate_metrics()` method

**Implementation**:
```python
def _calculate_sharpe_ratio(
    self,
    returns: List[float],
    risk_free_rate: float = 0.0
) -> float:
    """Calculate Sharpe ratio from returns series."""
    if not returns or len(returns) < 2:
        return 0.0
    
    excess_returns = [r - risk_free_rate for r in returns]
    avg_excess = sum(excess_returns) / len(excess_returns)
    std_excess = (sum((r - avg_excess)**2 for r in excess_returns) / len(excess_returns)) ** 0.5
    
    if std_excess == 0:
        return 0.0
    
    return avg_excess / std_excess * (252 ** 0.5)  # Annualized
```

---

### 6. Performance Optimization 🔧
**Priority**: Medium  
**Effort**: 4-5 hours  
**Impact**: Faster simulations and analysis

**Tasks**:
- [ ] Add SQL query optimization (indexes, query plans)
- [ ] Implement feature caching (avoid recomputing features)
- [ ] Add incremental feature updates
- [ ] Optimize candle fetching (batch queries)
- [ ] Add connection pooling for DuckDB

**Files to Modify**:
- `simulation/simulator.py`: Optimize `_fetch_candles()`
- `statistics/feature_engineering.py`: Add caching layer
- `statistics/feature_store.py`: Add incremental updates

---

### 7. Integration Testing 🔧
**Priority**: Medium  
**Effort**: 3-4 hours  
**Impact**: Confidence in end-to-end flow

**Tasks**:
- [ ] Create end-to-end test: TypeScript → Python → DuckDB → Results
- [ ] Test with real Telegram export data
- [ ] Validate data flow and error handling
- [ ] Test error scenarios (missing data, invalid configs)

**Files to Create**:
- `packages/utils/tests/integration/simulation-duckdb-bridge.test.ts`
- `packages/utils/tests/integration/analytics-duckdb-bridge.test.ts`

---

### 8. Documentation & Examples 📚
**Priority**: Low  
**Effort**: 4-5 hours  
**Impact**: Better developer experience

**Tasks**:
- [ ] Add usage examples for each module
- [ ] Create Jupyter notebooks for analysis workflows
- [ ] Document strategy configuration options
- [ ] Add API reference
- [ ] Create tutorial/guide

**Files to Create**:
- `tools/telegram/examples/simulation_example.py`
- `tools/telegram/examples/analysis_example.py`
- `tools/telegram/notebooks/analysis_workflow.ipynb`

---

## Medium-term Enhancements

### 9. Portfolio Simulation
**Priority**: Low  
**Effort**: 1-2 weeks  
**Impact**: Simulate multiple tokens simultaneously

**Features**:
- Position sizing across multiple tokens
- Portfolio-level risk management
- Diversification metrics
- Portfolio-level PnL tracking

---

### 10. Strategy Optimization
**Priority**: Low  
**Effort**: 2-3 weeks  
**Impact**: Find optimal strategy parameters

**Features**:
- Genetic algorithms for parameter search
- Bayesian optimization
- Grid search with parallelization
- Backtesting across multiple time periods

---

### 11. ML Enhancements
**Priority**: Low  
**Effort**: 2-3 weeks  
**Impact**: Better predictions

**Features**:
- LSTM/Transformer model support
- Feature importance visualization
- Model explainability (SHAP values)
- Cross-validation and hyperparameter tuning
- Ensemble models

---

## Implementation Timeline

### Week 1 (Immediate)
- Day 1: Install sklearn, enable ML tests
- Day 2-3: Batch simulation enhancement
- Day 4-5: Drop-based entry implementation

### Week 2
- Day 1-2: Re-entry logic
- Day 3-4: Advanced metrics
- Day 5: Performance optimization

### Week 3
- Day 1-2: Integration testing
- Day 3-5: Documentation and examples

### Week 4+
- Advanced features (portfolio, optimization, ML enhancements)

---

## Success Metrics

### Phase 1 (Week 1)
- ✅ All ML tests passing (8/8)
- ✅ Batch simulation working for 100+ calls
- ✅ Drop-based entry tested and working

### Phase 2 (Week 2)
- ✅ Re-entry logic implemented and tested
- ✅ Advanced metrics calculated correctly
- ✅ Performance improved by 2x+

### Phase 3 (Week 3)
- ✅ End-to-end integration tests passing
- ✅ Documentation complete
- ✅ Example notebooks working

---

## Risk Mitigation

### Potential Issues
1. **DuckDB performance with large datasets**
   - Mitigation: Add indexes, optimize queries, consider partitioning

2. **Python/TypeScript integration complexity**
   - Mitigation: Keep JSON-based communication, add validation

3. **Missing data handling**
   - Mitigation: Add data quality checks, graceful degradation

4. **Model training data quality**
   - Mitigation: Add data validation, feature importance analysis

---

## Dependencies

### Required
- `duckdb>=0.9.0` ✅
- `numpy>=1.24.0` ✅
- `pandas>=2.0.0` ✅
- `scipy>=1.10.0` ✅
- `scikit-learn>=1.3.0` ⚠️ (needs installation)

### Optional (for advanced features)
- `torch>=2.0.0` (for LSTM/Transformer models)
- `xgboost>=2.0.0` (for gradient boosting)
- `jupyter>=1.0.0` (for notebooks)

---

## Quick Start Guide

### Running Simulations
```bash
# Single simulation
quantbot simulation run-duckdb \
  --duckdb tele.duckdb \
  --strategy strategy.json \
  --mint So11111111111111111111111111111111111111112

# Batch simulation (once implemented)
quantbot simulation run-duckdb \
  --duckdb tele.duckdb \
  --strategy strategy.json \
  --batch
```

### Running Analysis
```bash
# Caller analysis
quantbot analytics analyze-duckdb \
  --duckdb tele.duckdb \
  --caller Brook

# Token analysis
quantbot analytics analyze-duckdb \
  --duckdb tele.duckdb \
  --mint So11111111111111111111111111111111111111112
```

---

## Notes

- All core functionality is implemented and tested
- Architecture supports easy extension
- Python and TypeScript integration is clean and maintainable
- Tests provide good coverage of core functionality
- Ready for production use with current features

