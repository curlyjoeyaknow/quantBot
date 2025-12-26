# Lab Sim Runner - E2E Tests

## Overview

End-to-end tests for the Lab Sim Runner verify the complete integration flow:
- Runner → Wiring → Workflow → Adapters

## Test Files

1. **`scripts/lab-sim.e2e.test.ts`** - Full E2E integration tests
2. **`scripts/lab-sim.test.ts`** - Unit tests for runner edge cases
3. **`scripts/lab-sim.wiring.test.ts`** - Security and validation tests
4. **`packages/workflows/src/slices/runSimPresets.test.ts`** - Workflow edge cases

## E2E Test Coverage

### Full Integration Flow
- ✅ Complete flow from preset to results
- ✅ Multiple presets handling
- ✅ Empty token sets
- ✅ Missing token sets

### Error Handling
- ✅ Adapter failures
- ✅ Partial failures
- ✅ All presets failing

### YAML Parsing
- ✅ Valid YAML presets
- ✅ Invalid YAML handling

### Token Set Reading
- ✅ Reading and filtering
- ✅ Empty token sets
- ✅ Comments handling

## Running Tests

```bash
# Run all lab sim tests
pnpm test lab-sim

# Run E2E tests specifically
pnpm test scripts/lab-sim.e2e.test.ts

# Run with coverage
pnpm test --coverage lab-sim
```

## Test Structure

### Mock Setup
- File system operations are mocked
- Adapters are stubbed (real implementations tested separately)
- Focus on integration, not adapter internals

### Test Patterns
1. **Setup**: Create mock files/directories
2. **Execute**: Call the workflow
3. **Verify**: Check results structure and content

## Integration Points Tested

1. **Runner → Wiring**
   - Preset loading
   - Token set loading
   - Error handling

2. **Wiring → Workflow**
   - Port instantiation
   - Preset passing
   - Result collection

3. **Workflow → Adapters**
   - Adapter calls
   - Error propagation
   - Result aggregation

## Edge Cases Covered

- Empty presets array
- Empty token sets
- Missing token sets
- Invalid YAML
- Adapter failures
- Partial failures
- All presets failing

## Future Enhancements

- Real adapter integration tests (with test databases)
- Performance tests
- Stress tests with many presets
- Concurrent execution tests



