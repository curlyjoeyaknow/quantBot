# tools/shared

Shared Python library code used by Python tool "apps" in `tools/*`.

## Architecture
- `packages/*` = TypeScript packages (strict ports/adapters).
- `tools/*` = Python "apps" (CLI scripts) invoked by TypeScript via `PythonEngine`.
- `tools/shared/*` = shared Python utilities (adapters/helpers) used by those apps.

## Boundary rule
- `tools/shared/*` MUST NOT import from `tools/storage/*`.
- `tools/storage/*` MAY import from `tools/shared/*`.

