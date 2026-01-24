# Lab UI

**Command**: `quantbot lab-ui`

**Package**: `lab-ui`

**Handler**: `packages/cli/src/handlers/lab-ui/lab-ui.ts`

## Description

Start the QuantBot Lab UI server (web interface for backtesting, optimization, and strategy management).

## Pattern

- **Handler**: Pure function pattern
- **Service**: Creates Lab UI server from `@quantbot/cli/lab-ui/server`
- **Server**: Express-based web server with EJS templates

## Options

- `--port <number>` - Server port (default: 3111)

## Examples

```bash
# Start Lab UI on default port
quantbot lab-ui

# Custom port
quantbot lab-ui --port 4000
```

## UI Features

The Lab UI provides:
- Strategy management (list, create, edit, compare)
- Optimization interface (grid search, random search)
- Equity curve visualization
- Profitable strategy finder
- Run tracking and analysis

## Related

- [[serve]] - Start API server

