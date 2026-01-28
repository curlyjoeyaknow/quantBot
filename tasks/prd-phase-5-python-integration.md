# PRD: Phase 5 - Python Integration & Advanced Features

## Overview

Phase 5 adds Python integration to enable advanced data science workflows, including Python-based strategy plugins, advanced analytics, and integration with the Python data science ecosystem (pandas, numpy, scikit-learn, etc.). This phase also adds advanced features like result visualization and machine learning integration.

## Goals

1. **Python Strategy Support**: Enable strategies to be written in Python
2. **Python Analysis Tools**: Provide Python utilities for advanced analysis
3. **Data Science Integration**: Integrate with pandas, numpy, scikit-learn
4. **Advanced Metrics**: Add advanced performance metrics and analysis
5. **Visualization**: Add result visualization capabilities

## Scope

### In Scope

- Python subprocess execution
- Python strategy plugin support
- Python analysis scripts
- Data marshalling (JSON)
- Python virtual environment management
- Advanced metrics calculation
- Basic visualization

### Out of Scope

- Full Python runtime embedding
- Real-time Python execution
- Complex ML model training
- Advanced visualization dashboard

## User Stories

### US-5.1: Create Python Strategy Plugin

**As a** data scientist  
**I want to** create a strategy plugin in Python  
**So that** I can leverage Python's data science libraries

**Acceptance Criteria:**

- Can create Python strategy file
- Can define plugin manifest
- Plugin receives JSON input (alerts, candles, config)
- Plugin returns JSON output (signals)
- Plugin can use pandas, numpy, etc.
- Plugin executes correctly

### US-5.2: Run Python Analysis Script

**As a** researcher  
**I want to** run Python analysis scripts on backtest results  
**So that** I can perform advanced analysis

**Acceptance Criteria:**

- Can specify Python script path
- Script receives results as JSON
- Script can access pandas, numpy
- Script outputs analysis results
- Results can be stored back in DuckDB

### US-5.3: Calculate Advanced Metrics

**As a** researcher  
**I want to** calculate advanced performance metrics  
**So that** I can better evaluate strategies

**Acceptance Criteria:**

- Can calculate risk-adjusted returns
- Can calculate drawdown metrics
- Can calculate correlation metrics
- Can calculate regime analysis
- Metrics are accurate

## Functional Requirements

### FR-5.1: Python Execution Engine

**Description**: Execute Python code via subprocess

**Requirements:**

- Execute Python scripts as subprocesses
- Pass JSON data via stdin/stdout
- Handle errors and timeouts
- Support virtual environments
- Log execution

**Source**: Borrow from `@quantbot/utils/src/PythonEngine.ts`

**Implementation:**

```typescript
class PythonEngine {
  async runScript(
    scriptPath: string,
    input: unknown,
    resultSchema: z.ZodSchema
  ): Promise<unknown> {
    // Execute Python script
    // Pass JSON via stdin
    // Read JSON from stdout
    // Validate result against schema
    // Return result
  }
  
  async runInVirtualEnv(
    venvPath: string,
    scriptPath: string,
    input: unknown
  ): Promise<unknown> {
    // Activate virtual environment
    // Execute script
    // Return result
  }
}
```

### FR-5.2: Python Strategy Plugin Interface

**Description**: Define interface for Python strategy plugins

**Python Script Interface:**

```python
# strategy.py
import json
import sys
import pandas as pd
import numpy as np

def initialize(config: dict) -> None:
    """Initialize strategy with configuration"""
    pass

def on_alert(alert: dict, context: dict) -> dict:
    """Process alert and return signal"""
    return {
        "type": "entry" | "exit" | "hold",
        "price": float | None,
        "size": float | None,
        "reason": str | None
    }

def on_candle(candle: dict, context: dict) -> dict:
    """Process candle and return signal"""
    return {"type": "hold"}

def on_exit(context: dict) -> None:
    """Cleanup"""
    pass

# Main execution loop
if __name__ == "__main__":
    # Read JSON from stdin
    # Parse command and data
    # Execute appropriate function
    # Write JSON to stdout
```

**TypeScript Integration:**

```typescript
class PythonStrategyPlugin implements StrategyPlugin {
  constructor(
    private scriptPath: string,
    private pythonEngine: PythonEngine
  ) {}
  
  async onAlert(alert: Alert, context: StrategyContext): Promise<Signal> {
    const input = {
      command: "on_alert",
      alert: alertToJson(alert),
      context: contextToJson(context)
    };
    
    const result = await this.pythonEngine.runScript(
      this.scriptPath,
      input,
      SignalSchema
    );
    
    return jsonToSignal(result);
  }
}
```

**Source**: Create new, inspired by quantbot's Python integration patterns

### FR-5.3: Data Marshalling

**Description**: Convert between TypeScript and Python data formats

**Requirements:**

- Convert TypeScript objects to JSON
- Convert JSON to TypeScript objects
- Handle DateTime serialization
- Handle NaN/Infinity
- Validate data

**Implementation:**

```typescript
function alertToJson(alert: Alert): unknown {
  return {
    id: alert.id,
    callerName: alert.callerName,
    mint: alert.mint,
    alertTimestamp: alert.alertTimestamp.toISO(),
    side: alert.side
  };
}

function jsonToSignal(json: unknown): Signal {
  return SignalSchema.parse(json);
}
```

**Source**: Create new

### FR-5.4: Python Analysis Scripts

**Description**: Provide Python utilities for result analysis

**Scripts:**

- `analyze_results.py`: Analyze backtest results
- `calculate_metrics.py`: Calculate advanced metrics
- `visualize_results.py`: Create visualizations
- `compare_runs.py`: Compare multiple runs

**Example Script:**

```python
# analyze_results.py
import json
import sys
import pandas as pd
import numpy as np

def analyze(results: dict) -> dict:
    """Analyze backtest results"""
    trades = pd.DataFrame(results["trades"])
    
    # Calculate metrics
    metrics = {
        "totalReturn": trades["pnl"].sum(),
        "winRate": (trades["pnl"] > 0).mean(),
        "sharpeRatio": calculate_sharpe(trades["pnl"]),
        # ... more metrics
    }
    
    return metrics

if __name__ == "__main__":
    input_data = json.load(sys.stdin)
    result = analyze(input_data)
    print(json.dumps(result))
```

**Source**: Create new, provide templates

### FR-5.5: Advanced Metrics Calculation

**Description**: Calculate advanced performance metrics

**Metrics:**

- Risk-adjusted returns (Sharpe, Sortino, Calmar)
- Drawdown analysis (max, average, recovery time)
- Correlation analysis
- Regime analysis
- Monte Carlo simulation
- Value at Risk (VaR)

**Source**: Create Python scripts, borrow from `@quantbot/analytics/`

**Implementation:**

```python
# advanced_metrics.py
def calculate_advanced_metrics(trades: pd.DataFrame) -> dict:
    returns = trades["pnlPercent"]
    
    metrics = {
        "sharpeRatio": calculate_sharpe(returns),
        "sortinoRatio": calculate_sortino(returns),
        "calmarRatio": calculate_calmar(returns),
        "maxDrawdown": calculate_max_drawdown(returns),
        "var95": calculate_var(returns, 0.95),
        "cvar95": calculate_cvar(returns, 0.95),
        # ... more metrics
    }
    
    return metrics
```

### FR-5.6: Visualization Support

**Description**: Generate visualizations from results

**Visualizations:**

- Equity curve
- Drawdown chart
- Trade distribution
- Monthly returns heatmap
- Strategy comparison charts

**Source**: Create Python scripts using matplotlib/plotly

**Implementation:**

```python
# visualize_results.py
import matplotlib.pyplot as plt
import pandas as pd

def plot_equity_curve(trades: pd.DataFrame, output_path: str):
    """Plot equity curve"""
    cumulative_pnl = trades["pnl"].cumsum()
    
    plt.figure(figsize=(12, 6))
    plt.plot(cumulative_pnl.index, cumulative_pnl.values)
    plt.title("Equity Curve")
    plt.xlabel("Trade Number")
    plt.ylabel("Cumulative P&L")
    plt.savefig(output_path)
    plt.close()
```

### FR-5.7: Virtual Environment Management

**Description**: Manage Python virtual environments

**Requirements:**

- Create virtual environments
- Install dependencies
- Activate environments
- List environments

**Implementation:**

```typescript
class PythonVenvManager {
  async createVenv(path: string): Promise<void> {
    // Create virtual environment
  }
  
  async installDependencies(
    venvPath: string,
    requirements: string[]
  ): Promise<void> {
    // Install packages
  }
  
  async getVenvPath(projectPath: string): Promise<string> {
    // Return venv path
  }
}
```

**Source**: Create new

### FR-5.8: Python Integration CLI Commands

**Description**: Add CLI commands for Python features

**Commands:**

```bash
python
  ├── strategy          # Python strategy commands
  │   ├── create        # Create Python strategy template
  │   └── test          # Test Python strategy
  ├── analyze           # Run Python analysis
  └── visualize         # Generate visualizations
```

**Source**: Create new

## Technical Specifications

### Python Requirements

- **Python**: 3.9+
- **Required Packages**:
  - pandas
  - numpy
  - matplotlib (for visualization)
  - scipy (for advanced metrics)

### Dependencies

**Python Package:**
- `@backtesting-platform/core` - Core types
- `child_process` - Subprocess execution
- `fs` - File system operations

### Code to Borrow from QuantBot

#### Python Engine
- `@quantbot/utils/src/PythonEngine.ts` - Python execution engine
- `@quantbot/storage/src/duckdb/duckdb-client.ts` - Python script execution pattern

#### Python Scripts
- `tools/storage/duckdb_*.py` - Python script examples
- Python script patterns from quantbot

## Implementation Tasks

### Task 5.1: Create Python Engine
- Implement PythonEngine class
- Add subprocess execution
- Add error handling
- Add timeout support

### Task 5.2: Implement Python Strategy Support
- Create Python strategy interface
- Implement data marshalling
- Add Python strategy plugin loader
- Add Python strategy executor

### Task 5.3: Create Python Analysis Scripts
- Create analyze_results.py
- Create calculate_metrics.py
- Create visualize_results.py
- Add script templates

### Task 5.4: Implement Advanced Metrics
- Create advanced metrics Python scripts
- Integrate with TypeScript
- Add metrics to result storage
- Add metrics to CLI output

### Task 5.5: Add Visualization Support
- Create visualization Python scripts
- Add CLI commands for visualization
- Add output formats (PNG, SVG, HTML)

### Task 5.6: Add Virtual Environment Management
- Implement VenvManager
- Add venv creation
- Add dependency installation
- Add venv activation

### Task 5.7: Add Python CLI Commands
- Add python strategy commands
- Add python analyze command
- Add python visualize command
- Add help text

### Task 5.8: Add Documentation
- Document Python strategy interface
- Document Python analysis scripts
- Add examples
- Add troubleshooting guide

## Success Criteria

1. ✅ Can create Python strategy plugin
2. ✅ Python strategy executes correctly
3. ✅ Can run Python analysis scripts
4. ✅ Advanced metrics are calculated
5. ✅ Visualizations are generated
6. ✅ Virtual environments work correctly
7. ✅ Python integration is documented

## Dependencies

- Phase 1 complete (data access)
- Phase 2 complete (backtesting engine)
- Phase 3 complete (plugin system)
- Phase 4 complete (CLI)
- Python 3.9+ installed

## Risks & Mitigations

**Risk**: Python execution performance  
**Mitigation**: Optimize data marshalling, use efficient formats

**Risk**: Python dependency management  
**Mitigation**: Document requirements, provide venv management

**Risk**: Python version compatibility  
**Mitigation**: Test on multiple Python versions, document requirements

**Risk**: Data marshalling overhead  
**Mitigation**: Optimize serialization, use efficient formats (Parquet)

## Open Questions

1. Should we support Jupyter notebooks?
2. Should we embed Python runtime?
3. How should we handle Python errors?
4. Should we support Python async strategies?

## Future Enhancements

- Jupyter notebook integration
- Real-time Python execution
- ML model training integration
- Advanced visualization dashboard
- Python package distribution

