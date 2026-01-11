# Simulation Configurations

This directory contains JSON configuration files for running simulations using the new config-driven simulation engine.

## Usage

Run a simulation configuration:

```bash
npm run simulate:config -- --config=configs/simulations/top-strategies.json
```

Or using ts-node directly:

```bash
ts-node scripts/simulation/run-engine.ts --config=configs/simulations/top-strategies.json
```

## Available Configs

### top-strategies.json
Runs simulations with the top 3 optimized strategies on all Brook channel calls.

### solana-callers-optimized.json
Complex multi-strategy simulation for Solana callers (coming soon).

## Config Schema

See `docs/guides/simulation-engine.md` for the complete configuration schema.

## Creating New Configs

1. Copy an existing config file
2. Modify the scenarios, data sources, and outputs
3. Test with a small dataset first
4. Run the full simulation

