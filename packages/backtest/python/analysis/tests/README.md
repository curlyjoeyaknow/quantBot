# ClickHouse Connection Tests

## Purpose

These tests ensure that ClickHouse connection failures are handled correctly with user-friendly error messages. **These tests would have caught the original signal-based timeout bug.**

## Test Categories

### Critical Tests (Would Have Caught Original Bug)

1. **`test_no_signal_handlers_used`** - Verifies that `signal.SIGALRM` is NOT used
   - The original bug used signal handlers which conflicted with the driver
   - This test reads the source code and fails if signal handlers are detected
   - **Would have failed immediately** if the original buggy code was present

2. **`test_timeout_parameters_passed_to_driver`** - Verifies timeout parameters are passed to the driver
   - Ensures `connect_timeout` and `send_receive_timeout` are actually used
   - **Would have failed** if someone removed the timeout parameters

3. **`test_real_connection_timeout_to_nonexistent_server`** (integration) - Real connection test
   - Attempts to connect to a non-existent server
   - Verifies timeout happens within expected time (not hanging)
   - **Would have caught** the confusing error messages in real usage

### Error Handling Tests

4. **`test_connection_timeout`** - TimeoutError handling
5. **`test_connection_refused`** - Connection refused handling
6. **`test_socket_timeout_error`** - Socket timeout conversion
7. **`test_clickhouse_driver_socket_timeout_error`** - Driver's SocketTimeoutError handling
8. **`test_generic_connection_error`** - Generic error handling
9. **`test_error_message_always_includes_actionable_info`** - Property test for error messages

### Configuration Tests

10. **`test_environment_variable_timeout_config`** - Environment variable configuration
11. **`test_timeout_configuration_from_environment`** - Multiple timeout values
12. **`test_error_message_includes_host_and_port`** - Error message details

### Performance Tests

13. **`test_no_hanging_on_connection_failure`** - Verifies failures are fast
14. **`test_successful_connection`** - Happy path

## Running Tests

### All Tests (Unit + Integration)
```bash
cd tools/analysis
pytest tests/test_clickhouse_connection.py -v
```

### Unit Tests Only (Fast, No Network)
```bash
pytest tests/test_clickhouse_connection.py -v -m "not integration"
```

### Integration Tests Only (Requires Network)
```bash
pytest tests/test_clickhouse_connection.py -v -m integration
```

## What These Tests Prevent

### Original Bug (Signal-Based Timeout)
- ❌ Used `signal.SIGALRM` for timeout handling
- ❌ Conflicted with clickhouse-driver's internal code
- ❌ Produced confusing error messages
- ❌ Didn't work on Windows

**Tests that would have caught it:**
- ✅ `test_no_signal_handlers_used` - Would fail immediately
- ✅ `test_timeout_parameters_passed_to_driver` - Would fail if parameters missing
- ✅ `test_real_connection_timeout_to_nonexistent_server` - Would catch confusing errors

### Future Regressions

These tests prevent:
- Removing timeout parameters
- Reverting to signal-based timeouts
- Breaking error message formatting
- Hanging on connection failures
- Losing error context (host, port, etc.)

## Test Coverage

- ✅ Signal handler detection (static analysis)
- ✅ Timeout parameter verification (mocking)
- ✅ Real connection failures (integration)
- ✅ Error message quality (property tests)
- ✅ Configuration handling (environment variables)
- ✅ Performance (no hanging)

## Integration Test Notes

Integration tests (`@pytest.mark.integration`) require:
- Network access (to test real connection failures)
- May take 2-5 seconds each (waiting for timeouts)

They can be skipped in CI if network is restricted:
```bash
pytest tests/test_clickhouse_connection.py -v -m "not integration"
```

## Maintenance

When modifying `get_clickhouse_client()`:
1. Run all tests: `pytest tests/test_clickhouse_connection.py -v`
2. Ensure `test_no_signal_handlers_used` still passes
3. Ensure `test_timeout_parameters_passed_to_driver` still passes
4. Update tests if timeout mechanism changes

