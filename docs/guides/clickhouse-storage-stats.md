# ClickHouse Storage Statistics

This document tracks ClickHouse storage statistics including table sizes and row counts.

## Current Statistics

*Last updated: 2025-01-26*

### Table Size and Row Count Summary

| Table/Chain | Row Count | Size | Notes |
|------------|-----------|------|-------|
| solana | 50,026,644 | 2,805 | Primary Solana data |
| SOL | 4,008,829 | 805 | SOL token data |
| Solana | 3,809,692 | 766 | Alternative Solana table |
| Ethereum | 2,284,096 | 97 | Ethereum chain data |
| ETH | 2,178,806 | 94 | ETH token data |
| ethereum | 1,441,205 | 158 | Alternative Ethereum table |
| bsc | 781,646 | 328 | Binance Smart Chain data |
| evm | 99,904 | 5 | EVM-compatible chains |
| base | 65,000 | 13 | Base chain data |
| BNB | 24,976 | 1 | BNB token data |
| Bsc | 19,976 | 1 | Alternative BSC table |
| sol | 10,800 | 1 | Alternative SOL table |

## Analysis

### Total Storage
- **Total Rows**: ~65.5 million rows
- **Largest Table**: `solana` with 50M+ rows
- **Primary Chains**: Solana (dominant), Ethereum, BSC

### Chain Distribution
- **Solana**: ~58M rows (88% of total)
- **Ethereum**: ~3.7M rows (6% of total)
- **BSC**: ~826K rows (1.3% of total)
- **Other**: ~3M rows (4.7% of total)

### Observations
1. Solana data dominates the storage (88% of rows)
2. Multiple table naming conventions exist (e.g., `solana` vs `Solana`, `ethereum` vs `Ethereum`)
3. Size units appear to be in MB (based on relative proportions)
4. Some tables have duplicate/alternative naming (e.g., `SOL` and `sol`, `Bsc` and `bsc`)

## Querying Storage Stats

Use the storage stats workflow to get current statistics:

```bash
# Get ClickHouse stats
quantbot storage stats-workflow --source clickhouse

# Get all storage stats (ClickHouse + DuckDB)
quantbot storage stats-workflow --source all
```

## Related Documentation

- [Storage Strategy](../architecture/STORAGE_STRATEGY.md)
- [ClickHouse Schema Mapping](./jesse-clickhouse-schema-mapping.md)
- [Storage Workflow](../architecture/WORKFLOW_ARCHITECTURE.md)

