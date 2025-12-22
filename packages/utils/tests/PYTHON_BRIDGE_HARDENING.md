# Python Bridge Foundation Hardening

## Overview

This document describes the comprehensive test suite that hardens the TypeScript/Python boundary in QuantBot. The goal is to ensure that when a handler calls a Python tool, the system either:

1. Returns a valid, schema-checked result, or
2. Fails loudly, deterministically, and safely

## Test Coverage

### 1. Process Behavior Failures (26 tests)

**File**: `tests/python-engine-failures.test.ts`

Tests how PythonEngine handles misbehaving Python tools:

#### Non-JSON stdout
- ✅ Fails with ValidationError when Python outputs non-JSON text
- ✅ Error message includes tool name and truncated output
- ✅ Does not claim partial artifacts on parse failure

#### JSON but invalid schema
- ✅ Fails when JSON does not match Zod schema
- ✅ Error clearly states which field is missing/invalid
- ✅ Handler does not swallow schema validation error

#### Mixed stdout + stderr
- ✅ Treats mixed stdout as invalid output (forces discipline)
- ✅ Documents contract: Python tools must log to stderr only

#### Non-zero exit code
- ✅ Throws AppError when Python exits with non-zero code
- ✅ Error includes exit code and stderr
- ✅ stdout is ignored when exit code is non-zero

#### Timeout / hang
- ✅ Kills process and throws TimeoutError when script exceeds timeout
- ✅ Error message includes timeout duration
- ✅ Subsequent runs still work after timeout (no zombie processes)

#### Huge stdout
- ✅ Aborts when output exceeds maxBuffer limit
- ✅ Error indicates output size exceeded

#### Non-determinism
- ✅ Fails when tool returns random data without seed
- ✅ Succeeds when input seed controls output (determinism enforced)
- ✅ Different seeds produce different outputs

#### Artifact claims without files
- ✅ Detects when Python claims artifacts that do not exist
- ✅ Manifest file path should be verified

#### Partial success is forbidden
- ✅ Fails when Python returns incomplete manifest
- ✅ Prevents "half-truth" runs

#### Error context quality
- ✅ Includes script path in all errors
- ✅ Provides enough context to debug failures
- ✅ Truncates large outputs in error messages

### 2. Handler Integration Tests (17 tests)

**File**: `tests/python-handler-integration.test.ts`

Tests that handlers properly propagate Python tool errors without swallowing them:

#### Error propagation
- ✅ ValidationError propagates through handler to executor
- ✅ TimeoutError propagates through handler to executor
- ✅ AppError propagates through handler to executor
- ✅ Zod validation errors propagate through handler

#### Handler does not swallow errors
- ✅ Handler does not catch and reformat errors
- ✅ Handler does not hide error context

#### No process.exit in handlers
- ✅ Handler throws errors instead of calling process.exit

#### Error context preservation
- ✅ Preserves script path through error chain
- ✅ Preserves exit code and stderr through error chain
- ✅ Preserves timeout duration through error chain

#### Success cases
- ✅ Handler returns validated result on success
- ✅ Executor receives successful result

#### Determinism
- ✅ Same input produces same output when seeded
- ✅ Handler can be called multiple times (REPL-friendly)

#### Real handler pattern
- ✅ Real handler pattern propagates errors correctly
- ✅ Real handler pattern fails loudly on error
- ✅ Real handler can be tested with mock context

### 3. Artifact Verification Tests (12 tests)

**File**: `tests/python-artifact-verification.test.ts`

Tests that PythonEngine can verify artifact files exist before claiming success:

#### Artifact existence verification
- ✅ Fails when artifact file does not exist
- ✅ Error message lists all missing artifacts
- ✅ Succeeds when all artifacts exist
- ✅ Verification can be disabled (default behavior)

#### Partial success prevention
- ✅ Prevents claiming success when artifacts are missing
- ✅ All-or-nothing: no partial results

#### Nested artifact verification
- ✅ Verifies artifacts in nested objects

#### Error context quality
- ✅ Includes result object in error context

#### Enhanced error messages
- ✅ Includes Zod error details in ValidationError
- ✅ Includes received data in error context
- ✅ Truncates stderr to prevent huge error messages
- ✅ Includes stdout for context on non-zero exit

## Test Fixtures

**Directory**: `tests/fixtures/bad-tools/`

Tiny Python scripts that intentionally misbehave:

1. **non_json.py** - Outputs non-JSON text
2. **wrong_schema.py** - Outputs valid JSON that doesn't match schema
3. **mixed_output.py** - Mixes log output with JSON on stdout
4. **non_zero_exit.py** - Exits with code 1 after writing to stderr
5. **timeout.py** - Sleeps longer than timeout
6. **huge_output.py** - Generates massive output exceeding buffer limits
7. **non_deterministic.py** - Returns random data unless seeded
8. **missing_artifacts.py** - Returns manifest pointing to files that don't exist
9. **partial_success.py** - Returns incomplete manifest
10. **good_tool.py** - Well-behaved tool for comparison

## Enhancements to PythonEngine

### Enhanced Error Handling

1. **Zod Validation Errors**: Now wrapped in `ValidationError` with context:
   - Script path
   - Zod error details (issues/errors)
   - Received data for debugging

2. **Subprocess Errors**: Enhanced with:
   - Truncated stderr (max 1000 chars)
   - Truncated stdout (max 500 chars) for context
   - Exit code
   - Script path

3. **Timeout Errors**: Include:
   - Timeout duration
   - Script path

### Artifact Verification

New method: `runScriptWithArtifacts()`

```typescript
await engine.runScriptWithArtifacts(
  scriptPath,
  args,
  schema,
  options,
  {
    verifyArtifacts: true,
    artifactFields: ['duckdb_file', 'artifacts', 'manifest']
  }
);
```

Features:
- Verifies file existence for specified fields
- Supports nested objects
- Supports arrays of file paths
- Throws `ValidationError` with list of missing artifacts
- Prevents "half-truth" runs

## Exit Criteria (All Met ✅)

- ✅ All failure-mode tests pass (26/26)
- ✅ All handler integration tests pass (17/17)
- ✅ All artifact verification tests pass (12/12)
- ✅ No handler contains subprocess logic
- ✅ No handler catches and hides Python errors
- ✅ All Python outputs are schema-validated
- ✅ Determinism is enforced via seed or input hash
- ✅ Artifact existence can be verified before success

## Test Results

```
Test Files  4 passed (4)
     Tests  57 passed (57)
  Duration  4.63s
```

## What This Guarantees

1. **No Silent Failures**: Python tools cannot fail silently. All failures are loud and structured.

2. **No Partial Success**: Tools cannot claim success while leaving corrupt or missing data.

3. **Deterministic Behavior**: Tools must accept seeds/inputs that control output for reproducibility.

4. **Error Context**: All errors include enough context to debug (script path, exit code, stderr, etc.).

5. **Handler Safety**: Handlers cannot swallow errors or hide failures from the executor.

6. **Artifact Integrity**: Optional verification ensures claimed files actually exist.

## What This Does NOT Test

- DuckDB logic correctness (tested in Python with pytest)
- Telegram parsing correctness (tested in Python with pytest)
- Simulation algorithm correctness (tested separately)
- Performance/benchmarking
- Concurrency/race conditions

## Future Enhancements

1. **Subprocess Resource Limits**: Add memory/CPU limits to prevent runaway processes
2. **Subprocess Sandboxing**: Run Python tools in isolated environments
3. **Retry Logic**: Add configurable retry with exponential backoff for transient failures
4. **Metrics**: Track Python tool execution times, failure rates, etc.
5. **Caching**: Cache deterministic tool outputs based on input hash

## Usage Example

```typescript
// In a handler
export async function myHandler(args: MyArgs, ctx: CommandContext) {
  const engine = ctx.services.pythonEngine();
  
  // With artifact verification
  const result = await engine.runScriptWithArtifacts(
    scriptPath,
    { input: args.input, seed: args.seed },
    MyResultSchema,
    { timeout: 30000 },
    {
      verifyArtifacts: true,
      artifactFields: ['duckdb_file', 'output_files']
    }
  );
  
  // Result is guaranteed to be:
  // 1. Valid according to schema
  // 2. All artifacts exist on filesystem
  // 3. Deterministic (if seed provided)
  
  return result;
}
```

## Conclusion

The Python bridge is now hardened against common failure modes. The system enforces a strict contract:

- **Python tools must**: Output valid JSON to stdout (last line), log to stderr, exit with 0 on success, be deterministic when seeded, create all claimed artifacts.

- **TypeScript handlers must**: Not catch Python errors, propagate errors to executor, not call process.exit, use CommandContext for services.

- **PythonEngine guarantees**: Schema validation, error context, timeout enforcement, optional artifact verification, no zombie processes.

This foundation is safe to build on.

