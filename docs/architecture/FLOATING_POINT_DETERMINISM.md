# Floating-Point Determinism Policy

## Policy

**All floating-point operations must be deterministic across platforms and JavaScript engines.**

## Requirements

1. **No platform-specific math** - Avoid operations that produce different results on different platforms
2. **Consistent rounding** - Use explicit rounding functions, not implicit truncation
3. **Deterministic order** - Sort arrays before operations that depend on order
4. **Fixed precision** - Use fixed decimal precision for financial calculations

## Implementation Guidelines

### Financial Calculations

- Use explicit rounding to fixed decimal places (e.g., 8 decimals for token prices)
- Avoid floating-point accumulation errors (use integer math where possible)
- Document precision requirements for each calculation

### Sorting and Ordering

- Always sort arrays before operations that depend on order
- Use stable sort algorithms
- Document sort criteria

### Platform Independence

- Test on multiple Node.js versions
- Verify results are identical across platforms
- Use deterministic algorithms (no random number generation without seeds)

## Testing

- Property tests for financial calculations
- Cross-platform verification tests
- Determinism regression tests

## Current Status

- Simulation engine uses seeded RNG for deterministic execution
- Financial calculations use explicit rounding
- Candle data is sorted before processing

## Future Work

- Add explicit precision requirements documentation
- Add cross-platform determinism tests
- Document all floating-point operation
