## Parameterized Simulation Engine

The repository now exposes a reusable simulation engine so we can run any strategy/caller batch without cloning and editing bespoke scripts.

### Key Building Blocks

- **Config schema (`src/simulation/config.ts`)**  
  Describe scenarios declaratively: data selector (`mint`, `file`, etc.), strategy legs, stop/entry/re-entry configs, cost assumptions, and output targets.
- **Simulation core (`src/simulation/engine.ts`)**  
  Provides both the pure `simulateStrategy` helper and the higher-level `SimulationEngine` class with pluggable candle providers and result sinks.
- **Target resolver (`src/simulation/target-resolver.ts`)**  
  Turns config data selectors into concrete `SimulationTarget` objects (supports single-mint windows and CSV lists today).
- **Sinks (`src/simulation/sinks.ts`)**  
  Dispatch results to stdout/JSON/CSV via the config-defined `outputs` array.
- **CLI (`scripts/simulation/run-engine.ts`)**  
  Single entrypoint for running any batch: `npm run simulate:config -- --config=configs/brook-top3.json`.

### Minimal Config Example

```json
{
  "version": "1",
  "global": {
    "defaults": {
      "stopLoss": { "initial": -0.3, "trailing": 0.5 },
      "outputs": [{ "type": "stdout", "detail": "summary" }]
    },
    "run": { "maxConcurrency": 4, "failFast": false }
  },
  "scenarios": [
    {
      "name": "Brook top tokens",
      "data": {
        "kind": "file",
        "path": "./data/exports/csv/all_brook_channels_calls.csv",
        "format": "csv",
        "mintField": "tokenAddress",
        "timestampField": "timestamp",
        "durationHours": 48,
        "filter": { "chain": "solana" }
      },
      "strategy": [
        { "target": 2, "percent": 0.5 },
        { "target": 4, "percent": 0.5 }
      ],
      "entry": { "initialEntry": "none", "trailingEntry": 0.1, "maxWaitTime": 60 },
      "outputs": [
        { "type": "stdout", "detail": "detailed" },
        { "type": "json", "path": "./data/simulations/brook.jsonl" }
      ]
    }
  ]
}
```

### Running the CLI

```bash
npm run simulate:config -- --config=configs/brook-top3.json --maxConcurrency=8 --cache-policy=refresh
```

Flags override config defaults (`--dry-run`, `--fail-fast`, `--cache-policy`).

### Programmatic API

```ts
import { SimulationEngine, parseSimulationConfig, DefaultTargetResolver } from '../src/simulation';

const config = parseSimulationConfig(rawConfig);
const resolver = new DefaultTargetResolver();
const engine = new SimulationEngine();

for (const scenario of config.scenarios) {
  const targets = await resolver.resolve(scenario);
  const summary = await engine.runScenario({ scenario, targets, runOptions: config.global.run });
  console.log(summary);
}
```

### Migrating Old Scripts

| Legacy script | New config focus |
| --- | --- |
| `analyze-solana-callers-optimized.ts` | Convert each `STRATEGIES` entry into a scenario; feed the same CSV through the `file` selector. |
| `run-top-strategies-simulation.ts` | Deduplicate Brook calls to a CSV/JSON feed and reference it in a single scenario with multiple strategy legs. |
| `simulate-caller.js` | Use the `mint` selector with explicit windows per alert or generate a CSV from `callerTracking` and reuse the CLI. |

Once configs replicate desired behaviors, we can delete/read-only the bespoke scripts and drive everything from `scripts/simulation/run-engine.ts`.

