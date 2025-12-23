# Research Services Examples

This directory contains example scripts demonstrating how to use the Research Services CLI commands.

## Available Examples

### 1. Create Snapshot (`create-snapshot-example.sh`)

Creates a data snapshot for a specific time range:

```bash
./examples/research/create-snapshot-example.sh
```

This will:
- Create a snapshot for January 1-2, 2024
- Save the snapshot reference to `snapshot.json`
- Display the snapshot contents

### 2. Create Execution Model (`create-execution-model-example.sh`)

Creates an execution model from calibration data:

```bash
./examples/research/create-execution-model-example.sh
```

This will:
- Create an execution model with latency samples
- Configure failure and partial fill rates
- Save the model to `execution-model.json`

### 3. Create Cost Model (`create-cost-model-example.sh`)

Creates a cost model from fee structure:

```bash
./examples/research/create-cost-model-example.sh
```

This will:
- Create a cost model with base fees and trading fees
- Configure priority fee ranges
- Save the model to `cost-model.json`

### 4. Create Risk Model (`create-risk-model-example.sh`)

Creates a risk model from constraints:

```bash
./examples/research/create-risk-model-example.sh
```

This will:
- Create a risk model with drawdown and loss limits
- Configure position size and consecutive loss limits
- Save the model to `risk-model.json`

### 5. Complete Simulation Workflow (`complete-simulation-example.sh`)

Demonstrates a complete workflow from snapshot creation to simulation:

```bash
./examples/research/complete-simulation-example.sh
```

This will:
1. Create a data snapshot
2. Create execution, cost, and risk models
3. Combine them into a simulation request
4. Show how to run the simulation

## Prerequisites

- QuantBot CLI installed and built
- `jq` installed (for JSON formatting in examples)
- Access to data sources (DuckDB with calls, OHLCV data)

## Usage

Make scripts executable:

```bash
chmod +x examples/research/*.sh
```

Run any example:

```bash
./examples/research/create-snapshot-example.sh
```

## Customization

Edit the scripts to customize:
- Time ranges for snapshots
- Calibration data for execution models
- Fee structures for cost models
- Risk constraints for risk models

## Next Steps

After creating snapshots and models, you can:

1. Use them in simulation requests (see `complete-simulation-example.sh`)
2. Run simulations: `quantbot research run --request-file simulation-request.json`
3. Analyze results: `quantbot research show --run-id <run-id>`

See the [Research Services Usage Guide](../../docs/guides/research-services-usage.md) for more details.


