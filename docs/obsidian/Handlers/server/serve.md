# Server Serve

**Command**: `quantbot serve`

**Package**: `server`

**Handler**: `packages/cli/src/handlers/server/serve.ts`

## Description

Start the QuantBot API server (Fastify-based REST API).

## Pattern

- **Handler**: Pure function pattern
- **Service**: Creates API server via `createApiServer()` from `@quantbot/cli/server`
- **Server**: Fastify-based REST API with OpenAPI/Swagger support

## Options

- `--port <number>` - Server port (default: 3000)
- `--host <host>` - Server host (default: "0.0.0.0")
- `--swagger` - Enable Swagger documentation
- `--no-swagger` - Disable Swagger documentation

## Examples

```bash
# Start server on default port
quantbot serve

# Custom port
quantbot serve --port 8080

# With Swagger enabled
quantbot serve --port 8080 --host localhost --swagger
```

## API Endpoints

Once started, the API provides:
- `/api/health` - Health check
- `/api/docs` - Swagger documentation (if enabled)
- Various endpoints for OHLCV, tokens, calls, simulations, ingestion

## Related

- [[lab-ui]] - Start Lab UI server

