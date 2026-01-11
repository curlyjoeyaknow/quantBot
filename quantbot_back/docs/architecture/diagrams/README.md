# Architecture Diagrams

This directory contains Mermaid diagrams documenting the foundation, core principles, and end-to-end flows of the QuantBot codebase.

## Foundation Diagrams

### 01-package-dependencies.mmd

**Package Dependency Graph**

Shows build order and dependencies between packages in the monorepo. Highlights `@quantbot/core` as the foundation with zero dependencies.

**Key Concepts:**

- Build order enforcement
- Foundation layer (core, utils)
- Infrastructure layer (storage, observability, api-clients)
- Service layer (ohlcv, analytics, ingestion)
- Application layer (simulation, workflows, cli, tui)

**Related Documentation:**

- [Build Ordering Rules](../../.cursor/rules/build-ordering.mdc)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

---

### 02-architecture-layers.mmd

**Architecture Layers**

Illustrates the three-layer architecture: Pure Compute, Orchestration, and Adapters.

**Key Concepts:**

- Pure Compute Layer: Simulation engine with no I/O
- Orchestration Layer: Workflows coordinate I/O operations
- Adapter Layer: CLI/TUI/API translate user intent to workflow specs
- Dependency rules between layers

**Related Documentation:**

- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)
- [SIMULATION_CONTRACT.md](../SIMULATION_CONTRACT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

---

### 03-ports-adapters.mmd

**Ports & Adapters Pattern**

Shows how handlers depend on ports (interfaces), adapters implement ports, and composition roots wire everything together.

**Key Concepts:**

- Ports: Interfaces defined in `@quantbot/core`
- Adapters: Concrete implementations in `packages/workflows/src/adapters/`
- Handlers: Pure business logic depending only on ports
- Composition Roots: Wire adapters to handlers

**Related Documentation:**

- [Ports & Adapters Rules](../../.cursor/rules/10-architecture-ports-adapters.mdc)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)

---

### 04-handler-purity.mmd

**Handler Purity Contract**

Shows what handlers CAN and CANNOT do, and where side effects live.

**Key Concepts:**

- Pure Logic: Handlers contain only business logic
- Port Dependencies: Handlers depend on ports, not implementations
- No Side Effects: Handlers cannot perform I/O, read env, or access global state
- Side Effects Location: All side effects live in adapters and composition roots

**Related Documentation:**

- [Handler Contract Rules](../../.cursor/rules/20-command-handler-contract.mdc)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [DETERMINISM.md](../DETERMINISM.md)

---

### 05-workflow-contract.mmd

**Workflow Contract**

Shows workflow signature pattern, WorkflowContext structure, and result contract.

**Key Concepts:**

- Spec Validation: All inputs validated with Zod schemas
- WorkflowContext: Dependency injection through context
- Default Parameter Pattern: Context uses default parameter, not optional
- JSON-Serializable Results: All results must be serializable
- Error Policy: Explicit collect vs fail-fast in spec

**Related Documentation:**

- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)
- [WORKFLOW_ENFORCEMENT.md](../WORKFLOW_ENFORCEMENT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

---

## End-to-End Flow Diagrams

### 06-cli-execution-flow.mmd

**CLI Command Execution Flow**

Complete flow from user input through CLI to handler to workflow to services.

**Key Concepts:**

- Thin Adapters: CLI handlers parse args, call workflow, format output
- No Orchestration in CLI: Multi-step logic lives in workflows
- CommandContext: Provides services via lazy initialization
- Error Handling: Centralized in executor
- Output Formatting: Handled by executor, not handlers

**Related Documentation:**

- [CLI Architecture](../../packages/cli/docs/CLI_ARCHITECTURE.md)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

---

### 07-golden-path.mmd

**Golden Path - Analytics Pipeline**

Complete analytics pipeline from Telegram export through ingestion, OHLCV collection, simulation, to analytics.

**Key Concepts:**

- Telegram Export: HTML export from Telegram containing caller alerts
- Ingestion: Parse and extract token addresses (case-preserved)
- OHLCV Collection: Fetch and store candle data
- Simulation: Run deterministic backtests
- Analytics: Evaluate performance metrics

**Related Documentation:**

- [README.md](../../README.md) - Golden Path overview
- [OHLCV_ARCHITECTURE.md](../OHLCV_ARCHITECTURE.md)
- [SIMULATION_CONTRACT.md](../SIMULATION_CONTRACT.md)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)

---

### 08-simulation-workflow.mmd

**Simulation Workflow E2E**

Complete simulation workflow from CLI command through handler, workflow, simulation service, to results.

**Key Concepts:**

- Gate 2 Compliance: Causal candle access prevents future data leakage
- Pure Simulation: Simulation engine has no I/O, clocks, or global config
- Causal Candle Accessor: Filters candles by closeTime <= simulationTime
- Workflow Orchestration: Workflow coordinates I/O, simulation is pure compute

**Related Documentation:**

- [SIMULATION_CONTRACT.md](../SIMULATION_CONTRACT.md)
- [DETERMINISM.md](../DETERMINISM.md)
- [determinism-gates.md](../determinism-gates.md)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)

---

### 09-ohlcv-ingestion.mmd

**OHLCV Ingestion Flow**

Complete OHLCV ingestion flow showing offline vs online separation, rate limiting, and caching.

**Key Concepts:**

- Offline Planning: Generate worklist from DuckDB (no API calls)
- Online Orchestration: Jobs service handles API calls, rate limiting
- Rate Limiting: Respect API limits with backoff
- Caching: ClickHouse for fast queries, DuckDB for analytics
- Deduplication: Prevent duplicate fetches

**Related Documentation:**

- [OHLCV_ARCHITECTURE.md](../OHLCV_ARCHITECTURE.md)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)
- [README.md](../../README.md) - OHLCV Data Management

---

### 10-data-flow.mmd

**Data Flow - Input to Output**

Complete data flow from input validation through processing to output formatting and artifact generation.

**Key Concepts:**

- Input Validation: Zod schemas validate all inputs
- Error Collection: Collect errors vs fail-fast modes
- Artifact Generation: Run manifests, CSV exports
- JSON-Serializable: All results must be serializable

**Related Documentation:**

- [ERROR_HANDLING.md](../ERROR_HANDLING.md)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)
- [CLI Architecture](../../packages/cli/docs/CLI_ARCHITECTURE.md)

---

## Proposed Live Feature Diagrams

### 11-telegram-bot-e2e.mmd

**Telegram Bot E2E Flow**

Complete flow from Telegram user message through bot, command parsing, handlers, workflows to response.

**Key Concepts:**

- Command Pattern: Each command has its own handler class
- Session Management: Track user state and session expiration
- Dependency Injection: All services injected via DI container
- User-Friendly Errors: Errors formatted for Telegram users
- Workflow Integration: Bot commands call same workflows as CLI

**Related Documentation:**

- [Bot Rules](../../.cursor/rules/bot.mdc)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)
- [README.md](../../README.md) - Telegram Bot Commands

---

### 12-live-monitoring-e2e.mmd

**Live Monitoring E2E Flow**

Complete flow for live monitoring from Telegram channel messages through CA drop detection, price tracking, to alerts.

**Key Concepts:**

- CA Drop Detection: Parse Telegram channel messages for token addresses
- Watchlist Management: Track monitored tokens with cooldown logic
- Real-Time Price Tracking: WebSocket streams from Helius/Shyft
- Alert Evaluation: Check profit targets, stop-loss conditions
- Performance Summaries: Hourly and daily reports

**Related Documentation:**

- [Monitoring Package Rules](../../.cursor/rules/packages-monitoring.mdc)
- [README.md](../../README.md) - Real-Time CA Monitoring
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)

---

### 13-live-execution-e2e.mmd

**Live Trading Execution E2E Flow**

Complete flow for live trading execution from alert trigger through risk gates, ExecutionPort, to transaction submission.

**Key Concepts:**

- ExecutionPort Interface: Handlers depend on ports, not implementations
- Executor App Boundary: Live trading concerns isolated in separate boundary
- Safety Features: Dry-run mode, circuit breaker, idempotency
- Risk Gates: Position limits, drawdown checks, daily loss limits
- Transaction Building: Solana transaction construction with Jito/RPC submission

**Related Documentation:**

- [Execution Port Migration](../execution-port-migration.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Live Execution Architecture
- [README.md](../../README.md) - Live Execution Architecture

---

### 14-complete-live-pipeline.mmd

**Complete Live Trading Pipeline**

End-to-end flow from Telegram CA drop detection through monitoring, strategy signals, execution, to position management and exit.

**Key Concepts:**

- Detection: CA drop detection from Telegram channels
- Monitoring: Real-time price tracking and alert evaluation
- Strategy Signals: Entry/exit conditions based on strategy
- Risk Management: Risk gates before execution
- Execution: Transaction building and submission
- Position Management: Track positions and manage exits

**Related Documentation:**

- [Execution Port Migration](../execution-port-migration.md)
- [WORKFLOW_ARCHITECTURE.md](../WORKFLOW_ARCHITECTURE.md)
- [README.md](../../README.md) - Complete feature overview

---

## Rendering Diagrams

These diagrams are written in Mermaid format (`.mmd` files). To render them:

1. **VS Code**: Install the "Markdown Preview Mermaid Support" extension
2. **GitHub**: Mermaid diagrams render automatically in markdown files
3. **Online**: Use [Mermaid Live Editor](https://mermaid.live/)
4. **CLI**: Use `@mermaid-js/mermaid-cli` to generate images

## Diagram Conventions

- **Node Names**: Use camelCase or PascalCase (no spaces)
- **Edge Labels**: Quote labels containing special characters
- **Subgraphs**: Use explicit IDs with labels in brackets
- **Colors**: No explicit colors (theme handles colors automatically)
- **Reserved Keywords**: Avoid `end`, `subgraph`, `graph`, `flowchart` as node IDs

## Contributing

When adding new diagrams:

1. Follow the naming convention: `NN-description.mmd`
2. Include frontmatter with title and description
3. Add comprehensive documentation in the diagram file
4. Update this README with the new diagram
5. Link to related documentation
