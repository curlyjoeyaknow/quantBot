# Bug Fix: Variable Scope Error in alerts.py

**Date**: 2026-01-21  
**Status**: ✅ FIXED  
**Severity**: 🔴 CRITICAL (crashed optimizer after 2,398 iterations)

---

## Summary

Random search optimizer failed repeatedly with:
```
NameError: name 'has_canon_alerts_final' is not defined
```

**Root cause**: Partial refactor renamed parameter from `has_canon_alerts_final` to `has_mcap` in function signatures but didn't update all references inside function bodies.

---

## Affected Functions

### 1. `_load_from_caller_links()` (Line 133-196)

**Before** (line 182):
```python
sql += " AND lower(c.chain) = lower(?)" if has_canon_alerts_final else " AND lower(chain) = lower(?)"
```

**After** (line 182):
```python
sql += " AND lower(c.chain) = lower(?)" if has_mcap else " AND lower(chain) = lower(?)"
```

### 2. `_load_from_user_calls()` (Line 199-266)

**Before** (line 252):
```python
sql += " AND lower(u.chain) = lower(?)" if has_canon_alerts_final else " AND lower(chain) = lower(?)"
```

**After** (line 252):
```python
sql += " AND lower(u.chain) = lower(?)" if has_mcap else " AND lower(chain) = lower(?)"
```

---

## Impact

- **Duration**: 6+ hours of failed optimizer runs
- **Iterations failed**: 2,398+ (every single iteration)
- **Data lost**: None (early crash before any processing)
- **Production impact**: N/A (caught in dev/research)

---

## Verification

1. ✅ Grep shows all `has_canon_alerts_final` references are now in correct scope
2. ✅ Parameter names match usage throughout functions
3. ⚠️ Regression test created but needs proper pytest infrastructure

---

## Prevention

**Immediate**:
- [x] Fix both functions (lines 182, 252)
- [ ] Run optimizer to confirm fix
- [ ] Add to CHANGELOG.md

**Long-term**:
- Add type checking/linting to catch undefined variables
- Add pre-commit hook to run Python unit tests
- Consider using mypy or pylint for static analysis

---

## Related Files

- `tools/backtest/lib/alerts.py` (fixed)
- `tools/backtest/run_random_search.py` (caller)
- `tools/backtest/lib/tests/test_alerts_regression.py` (test, needs work)

---

## Lessons Learned

1. **Partial refactors are dangerous** - rename parameter everywhere or nowhere
2. **Long-running processes fail silently** - 6 hours of failures before human intervention
3. **Python scoping is subtle** - variable defined in outer scope isn't visible in inner function
4. **Testing is critical** - this would have been caught by basic unit tests

---

**Fix committed**: 2026-01-21  
**Fixed by**: Architecture Review Assistant

