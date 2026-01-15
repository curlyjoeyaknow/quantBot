# Lab Logging Follow-up Work

This worktree is for implementing the next steps of the structured logging system.

## Current Status

✅ **Completed:**

- LogHub with structured log events (ts, level, scope, msg, ctx, requestId, runId)
- Fastify server endpoints: `/api/logs` and `/api/logs/stream`
- Request ID middleware for correlation
- Logging added to all existing API endpoints
- Logs tab in UI with filtering and live streaming

## Next Steps

### Immediate (Testing & Validation)

1. **Test the logging system**
   - Start server: `pnpm --filter @quantbot/lab dev`
   - Visit `http://localhost:3001` and test Logs tab
   - Verify filters work (scope, level, search)
   - Test live streaming functionality

2. **Integration tests** (optional)
   - Add tests for `/api/logs` filtering
   - Add tests for `/api/logs/stream` SSE connection
   - Verify log event structure

### Short-term (Enhance Logging Coverage)

3. **Add logging to workflow operations**
   - `runLabPreset` - log strategy runs with runId
   - `runOptimization` - log optimization jobs
   - `runRollingWindows` - log window executions
   - Use scopes: `backtest`, `optimization`, `simulation`

4. **Add runId correlation**
   - Generate runId at workflow start
   - Pass runId through workflow context
   - Emit logs with runId for correlation
   - Enable filtering by runId in UI

### Medium-term (Enhancements)

5. **Log persistence** (optional)
   - Persist logs to ClickHouse or DuckDB
   - Add retention policy
   - Enable historical log queries

6. **Documentation**
   - Document LogHub API
   - Document log event structure
   - Add examples for adding logging to new endpoints
   - Document filtering patterns

7. **Performance monitoring**
   - Add performance metrics to log context (duration, counts)
   - Track slow operations
   - Add alerts for error rates

## Quick Test

```bash
# Start the server
cd packages/lab
pnpm dev

# In another terminal, test the API
curl "http://localhost:3001/api/logs?scope=strategies&level=info&limit=10"
```

## Branch Info

- **Branch:** `feature/lab-logging-followup`
- **Base:** `feature/slice-export-analyze` (commit 38f8e5ad)
- **Location:** `/home/memez/quantBot-logging`
