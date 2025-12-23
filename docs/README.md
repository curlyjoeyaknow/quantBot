# QuantBot Documentation

Welcome to the QuantBot documentation. This directory contains comprehensive documentation for the QuantBot trading research platform.

## Structure

### 📁 [architecture/](./architecture/)
Core architecture documentation, design decisions, and system design patterns.

### 📁 [api/](./api/)
API documentation, endpoint references, and integration guides.

### 📁 [guides/](./guides/)
User guides, tutorials, and how-to documentation for common tasks.

### 📁 [migration/](./migration/)
Migration guides, deprecation notices, and upgrade instructions.

### 📁 [reviews/](./reviews/)
Code review documents, status reports, and completion summaries.

### 📁 [roadmap/](./roadmap/)
Project roadmap, future plans, and strategic direction.

### 📁 [testing/](./testing/)
Testing documentation, coverage reports, and test strategy.

### 📁 [examples/](./examples/)
Practical examples, code samples, and workflow demonstrations.

## Quick Links

- [Architecture Overview](./architecture/ARCHITECTURE.md)
- [Boundaries & Policy](./BOUNDARIES.md) - **Simulation lab only - no live trading**
- [API Reference](./api/API.md)
- [CLI Setup Guide](./guides/cli-setup.md)
- [Research Services Usage](./guides/research-services-usage.md)
- [Research Workflow Examples](./examples/research-workflow-examples.md)
- [Migration Guides](./migration/)

## Important: Simulation Lab Only

**QuantBot is a simulation lab only. It does not execute live trades.**

- ✅ **Allowed**: Data ingestion, simulations, sweeps, artifact generation
- ❌ **Forbidden**: Transaction signing, submission, private keys, live execution

The `ExecutionPort` interface in this repository is **simulation-only**. It models execution behavior; it does not execute real trades.

See [BOUNDARIES.md](./BOUNDARIES.md) for the complete policy and enforcement mechanisms.

## Contributing

When adding new documentation:

1. **Place files in appropriate subdirectories** - Don't add files to the root `docs/` directory
2. **Use descriptive names** - Use kebab-case for file names
3. **Update this README** - Add links to new documentation
4. **Follow markdown standards** - Use proper heading hierarchy and formatting

## Documentation Standards

- Use clear, concise language
- Include code examples where helpful
- Keep documentation up to date with code changes
- Cross-reference related documents
- Use proper markdown formatting

