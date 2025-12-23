# QuantBot Boundaries - Simulation Lab Only

**Status**: ✅ ENFORCED  
**Date**: 2025-01-23  
**Policy**: QuantBot is a simulation lab only. Live trading is explicitly forbidden.

## Scope: What QuantBot May Do

QuantBot is a **simulation and research laboratory**. It may:

✅ **Ingest data**

- Parse Telegram exports
- Fetch OHLCV data
- Load historical market data
- Process call alerts

✅ **Run simulations/sweeps**

- Backtest strategies
- Run parameter sweeps
- Generate simulation results
- Calculate metrics and analytics

✅ **Produce artifacts, reports, and exported strategy bundles**

- Generate run manifests
- Export strategy configurations
- Create performance reports
- Produce analysis artifacts

## Forbidden: What QuantBot May NOT Do

QuantBot **must never**:

❌ **Sign transactions**

- No `Keypair.fromSecretKey()`
- No `signTransaction()`
- No `signAllTransactions()`
- No private key handling

❌ **Submit to RPC/Jito/TPU**

- No `sendTransaction()`
- No `sendRawTransaction()`
- No Jito block engine clients
- No transaction submission

❌ **Hold private keys / mnemonics**

- No keypair loaders
- No mnemonic parsing
- No secret key storage
- No `process.env.*PRIVATE*|*SECRET*|*MNEMONIC*`

❌ **Include execution adapters beyond "paper/dry-run simulation"**

- ExecutionPort is simulation-only
- No real RPC connections for execution
- No real transaction building for live trading

## Enforcement

### ESLint Rules

Banned imports:

- `@solana/web3.js` signing/submission APIs
- Jito block engine clients
- Keypair loaders
- Any library that enables transaction signing or submission

**Allowed**: Read-only Solana types for data decoding:
- `PublicKey` from `@solana/web3.js` (for address validation/parsing)
- Other read-only types as needed for data processing

### Why PublicKey is Allowed

`PublicKey` is a **read-only data structure** used for:

1. **Address Validation** - Validating that strings extracted from Telegram messages are actually valid Solana addresses
   - Base58 decoding → exactly 32 bytes
   - Prevents storing invalid addresses in the database
   - Used in: `packages/utils/src/address/validate.ts`, `packages/ingestion/src/extractSolanaAddresses.ts`

2. **PDA Derivation** - Deriving Program Derived Addresses (e.g., Pump.fun bonding curve addresses)
   - Used for data analysis and simulation
   - Used in: `packages/utils/src/pumpfun.ts`

3. **Address Normalization** - Converting addresses to canonical form while preserving case
   - Ensures consistent storage format
   - Used throughout ingestion pipeline

**PublicKey does NOT enable:**
- ❌ Transaction signing
- ❌ Transaction submission  
- ❌ Private key loading
- ❌ Any live trading functionality

It's purely a **data validation and transformation tool**, similar to using a JSON parser or regex validator. The CI check allows `PublicKey` imports but will catch actual signing/submission usage.

### CI Checks

The build will fail if code contains:

- `Keypair.fromSecretKey`
- `sendTransaction`, `sendRawTransaction`
- `signTransaction`, `signAllTransactions`
- `process.env.*PRIVATE*|*SECRET*|*MNEMONIC*`
- Other forbidden patterns (see `scripts/ci/check-no-live-trading.ts`)

### Code Review

All PRs must verify:

- No live trading code
- No transaction signing
- No private key handling
- ExecutionPort remains simulation-only

## Strategy Bundle Export Format

QuantBot exports **Strategy Bundles**, not executables.

A bundle contains:

1. **Strategy definition** (DSL/config)
   - Entry/exit rules
   - Profit targets
   - Stop loss configuration
   - Re-entry logic

2. **Version + hash**
   - Strategy version
   - Content hash for verification
   - Schema version

3. **Required features list**
   - OHLCV data requirements
   - Indicator dependencies
   - Data quality requirements

4. **Expected execution model assumptions**
   - Latency distributions (p50, p90, p99)
   - Slippage models
   - Failure rate assumptions
   - Partial fill probabilities

5. **Test vectors / golden scenarios**
   - Known good inputs/outputs
   - Regression test cases
   - Performance benchmarks

The future live trading fork can import that bundle and implement the runtime.

## ExecutionPort Clarification

**Critical**: `ExecutionPort` is **simulation-only** in this repo.

- It **models** execution (latency, slippage, failures)
- It does **not** execute real transactions
- It does **not** connect to real RPC endpoints for trading
- It does **not** sign or submit transactions

If you need real execution, create a separate repository that:

1. Imports strategy bundles from QuantBot
2. Implements ExecutionPort with real adapters
3. Handles key management and transaction signing
4. Connects to real RPC/Jito/TPU endpoints

## Rationale

This boundary exists to:

1. **Prevent accidental live trading**
   - No risk of deploying untested code to production
   - No risk of exposing private keys
   - No risk of losing funds

2. **Maintain focus**
   - QuantBot is a research tool, not a trading bot
   - Focus on strategy development and backtesting
   - Avoid operational complexity of live trading

3. **Enable reproducibility**
   - Simulation results are deterministic
   - No external dependencies on live markets
   - Results can be verified and reproduced

4. **Separate concerns**
   - Strategy development (QuantBot)
   - Live execution (separate repository)
   - Clear contract between them (Strategy Bundles)

## Related Documents

- [Architecture](./architecture/ARCHITECTURE.md)
- [Simulation Contract](./architecture/SIMULATION_CONTRACT.md)
- [Python DB Driver Decision](./architecture/PYTHON_DB_DRIVER_DECISION.md)
