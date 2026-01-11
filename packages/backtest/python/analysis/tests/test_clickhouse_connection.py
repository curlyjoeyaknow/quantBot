#!/usr/bin/env python3
"""
Tests for ClickHouse connection handling in ohlcv_caller_coverage.py

These tests ensure that connection failures are properly handled and
user-friendly error messages are provided.

CRITICAL: These tests would have caught the original signal-based timeout bug.
They verify:
1. No signal handlers are used (would fail if signal.SIGALRM is used)
2. Timeout parameters are passed to the driver (would fail if removed)
3. Real connection failures are handled correctly (integration test)
4. Error messages are always user-friendly
"""

import os
import pytest
import socket
import signal
import inspect
from unittest.mock import patch, MagicMock
import sys

# Add parent directory to path to import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ohlcv_caller_coverage import get_clickhouse_client


class TestClickHouseConnection:
    """Test ClickHouse connection error handling"""

    def test_connection_timeout(self):
        """Test that connection timeout is properly handled"""
        # Mock ClickHouse client to raise timeout error
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            
            # Simulate timeout error
            mock_client.execute.side_effect = TimeoutError("Connection timed out")
            
            with pytest.raises(TimeoutError) as exc_info:
                get_clickhouse_client()
            
            # Verify error message is user-friendly
            assert "timeout" in str(exc_info.value).lower()
            assert "ClickHouse" in str(exc_info.value)
            assert "running" in str(exc_info.value).lower() or "accessible" in str(exc_info.value).lower()

    def test_connection_refused(self):
        """Test that connection refused errors are properly handled"""
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            
            # Simulate connection refused
            mock_client.execute.side_effect = Exception("Connection refused")
            
            with pytest.raises(ConnectionError) as exc_info:
                get_clickhouse_client()
            
            # Verify error message provides helpful guidance
            error_msg = str(exc_info.value).lower()
            assert "connection refused" in error_msg or "refused" in error_msg
            assert "clickhouse" in error_msg
            assert "running" in error_msg

    def test_socket_timeout_error(self):
        """Test that socket timeout errors are properly handled"""
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            
            # Simulate socket timeout (this is what the driver actually raises)
            timeout_error = socket.timeout("The read operation timed out")
            mock_client.execute.side_effect = timeout_error
            
            with pytest.raises(TimeoutError) as exc_info:
                get_clickhouse_client()
            
            # Verify it's converted to TimeoutError with helpful message
            assert isinstance(exc_info.value, TimeoutError)
            assert "timeout" in str(exc_info.value).lower()

    def test_generic_connection_error(self):
        """Test that generic connection errors are properly handled"""
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            
            # Simulate generic error
            mock_client.execute.side_effect = Exception("Network is unreachable")
            
            with pytest.raises(ConnectionError) as exc_info:
                get_clickhouse_client()
            
            # Verify error message includes original error
            assert "Network is unreachable" in str(exc_info.value)

    def test_successful_connection(self):
        """Test that successful connection returns client and database"""
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            mock_client.execute.return_value = [(1,)]
            
            # Set default database in environment
            with patch.dict(os.environ, {'CLICKHOUSE_DATABASE': 'testdb'}):
                client, database = get_clickhouse_client()
            
            assert client == mock_client
            assert database == 'testdb'
            mock_client.execute.assert_called_once_with('SELECT 1')

    def test_environment_variable_timeout_config(self):
        """Test that timeout can be configured via environment variables"""
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            mock_client.execute.return_value = [(1,)]
            
            # Set custom timeout
            with patch.dict(os.environ, {'CLICKHOUSE_CONNECT_TIMEOUT': '10'}):
                get_clickhouse_client()
            
            # Verify timeout was passed to client
            mock_client_class.assert_called_once()
            call_kwargs = mock_client_class.call_args[1]
            assert call_kwargs['connect_timeout'] == 10

    def test_clickhouse_driver_socket_timeout_error(self):
        """Test handling of clickhouse_driver's SocketTimeoutError"""
        # Import the actual error type from clickhouse_driver if available
        try:
            from clickhouse_driver.errors import SocketTimeoutError
            
            with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
                mock_client = MagicMock()
                mock_client_class.return_value = mock_client
                
                # Simulate the actual error type the driver raises
                mock_client.execute.side_effect = SocketTimeoutError("Code: 209. (localhost:8123)")
                
                with pytest.raises(TimeoutError) as exc_info:
                    get_clickhouse_client()
                
                # Should be converted to TimeoutError
                assert isinstance(exc_info.value, TimeoutError)
                assert "timeout" in str(exc_info.value).lower()
        except ImportError:
            # If SocketTimeoutError is not available, skip this test
            pytest.skip("clickhouse_driver.errors.SocketTimeoutError not available")

    def test_error_message_includes_host_and_port(self):
        """Test that error messages include connection details"""
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            mock_client.execute.side_effect = Exception("Connection failed")
            
            with patch.dict(os.environ, {
                'CLICKHOUSE_HOST': 'testhost',
                'CLICKHOUSE_PORT': '8123'
            }):
                with pytest.raises(ConnectionError) as exc_info:
                    get_clickhouse_client()
            
            # Error message should include host and port
            error_msg = str(exc_info.value)
            assert 'testhost' in error_msg
            assert '8123' in error_msg


    def test_no_signal_handlers_used(self):
        """
        CRITICAL: This test would have caught the original bug.
        
        Verifies that signal.SIGALRM is NOT used for timeout handling.
        The original bug used signal handlers which conflicted with the driver.
        """
        # Read the source code to ensure no signal handlers
        import ohlcv_caller_coverage
        source_file = inspect.getfile(ohlcv_caller_coverage.get_clickhouse_client)
        
        with open(source_file, 'r') as f:
            source_code = f.read()
        
        # Check that signal.SIGALRM is not used
        # The original bug had: signal.signal(signal.SIGALRM, timeout_handler)
        assert 'signal.SIGALRM' not in source_code, (
            "CRITICAL: Signal handlers should not be used for timeout handling. "
            "Use the driver's built-in timeout parameters instead."
        )
        assert 'signal.alarm' not in source_code, (
            "CRITICAL: signal.alarm should not be used. "
            "Use the driver's built-in timeout parameters instead."
        )
        
        # Verify the function doesn't use signal module at all
        # (it might be imported but not used, which is fine)
        if 'import signal' in source_code:
            # If signal is imported, verify it's not used in get_clickhouse_client
            func_source = inspect.getsource(ohlcv_caller_coverage.get_clickhouse_client)
            assert 'signal.' not in func_source, (
                "CRITICAL: get_clickhouse_client should not use signal module. "
                "Use driver's built-in timeout parameters."
            )

    def test_timeout_parameters_passed_to_driver(self):
        """
        CRITICAL: This test would have caught if timeout parameters were removed.
        
        Verifies that connect_timeout and send_receive_timeout are actually
        passed to the ClickHouseClient constructor.
        """
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            mock_client.execute.return_value = [(1,)]
            
            # Call with custom timeout
            with patch.dict(os.environ, {
                'CLICKHOUSE_CONNECT_TIMEOUT': '7',
                'CLICKHOUSE_SEND_RECEIVE_TIMEOUT': '90'
            }):
                get_clickhouse_client()
            
            # Verify client was created with timeout parameters
            assert mock_client_class.called, "ClickHouseClient should be instantiated"
            call_kwargs = mock_client_class.call_args[1]
            
            # CRITICAL: These parameters must be present
            assert 'connect_timeout' in call_kwargs, (
                "CRITICAL: connect_timeout must be passed to ClickHouseClient. "
                "This would have caught the original bug."
            )
            assert 'send_receive_timeout' in call_kwargs, (
                "CRITICAL: send_receive_timeout must be passed to ClickHouseClient."
            )
            
            # Verify values match environment variables
            assert call_kwargs['connect_timeout'] == 7
            assert call_kwargs['send_receive_timeout'] == 90

    @pytest.mark.integration
    def test_real_connection_timeout_to_nonexistent_server(self):
        """
        INTEGRATION TEST: This would have caught the original bug in real usage.
        
        Attempts to connect to a non-existent ClickHouse server and verifies:
        1. Connection fails with a timeout (not hanging forever)
        2. Error message is user-friendly
        3. Timeout happens within reasonable time (not signal-based)
        """
        import time
        
        # Use a non-existent host that will timeout
        with patch.dict(os.environ, {
            'CLICKHOUSE_HOST': '192.0.2.1',  # RFC 3330 test address (guaranteed unreachable)
            'CLICKHOUSE_PORT': '9000',
            'CLICKHOUSE_CONNECT_TIMEOUT': '2'  # Short timeout for test
        }):
            start_time = time.time()
            
            with pytest.raises((TimeoutError, ConnectionError)) as exc_info:
                get_clickhouse_client()
            
            elapsed = time.time() - start_time
            
            # Verify timeout happened within reasonable time (2-5 seconds)
            # If signal handlers were used, this might hang or behave differently
            assert 1.5 <= elapsed <= 6.0, (
                f"Connection should timeout in ~2 seconds, but took {elapsed:.2f}s. "
                "This might indicate signal handler issues."
            )
            
            # Verify error message is helpful
            error_msg = str(exc_info.value).lower()
            assert 'timeout' in error_msg or 'connection' in error_msg
            assert 'clickhouse' in error_msg

    @pytest.mark.integration
    def test_real_connection_refused_to_closed_port(self):
        """
        INTEGRATION TEST: Tests connection to a port that's definitely closed.
        
        This verifies that connection refused errors are handled correctly
        without using signal handlers.
        """
        # Use localhost with a port that's definitely not ClickHouse
        # Port 1 is typically not in use
        with patch.dict(os.environ, {
            'CLICKHOUSE_HOST': 'localhost',
            'CLICKHOUSE_PORT': '1',  # Port 1 is typically not in use
            'CLICKHOUSE_CONNECT_TIMEOUT': '2'
        }):
            with pytest.raises((ConnectionError, TimeoutError)) as exc_info:
                get_clickhouse_client()
            
            # Should fail quickly (connection refused, not timeout)
            error_msg = str(exc_info.value).lower()
            # Either connection refused or timeout is acceptable
            assert 'connection' in error_msg or 'timeout' in error_msg
            assert 'clickhouse' in error_msg

    def test_error_message_always_includes_actionable_info(self):
        """
        Property test: Error messages must always include actionable information.
        
        This ensures error messages are always helpful, not just sometimes.
        """
        error_scenarios = [
            ("Connection timed out", "timeout"),
            ("Connection refused", "refused"),
            ("Network is unreachable", "network"),
            ("Code: 209. (localhost:8123)", "209"),  # SocketTimeoutError
            ("Socket timeout", "timeout"),
            ("ECONNREFUSED", "refused"),
        ]
        
        for error_text, expected_keyword in error_scenarios:
            with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
                mock_client = MagicMock()
                mock_client_class.return_value = mock_client
                mock_client.execute.side_effect = Exception(error_text)
                
                with pytest.raises((TimeoutError, ConnectionError)) as exc_info:
                    get_clickhouse_client()
                
                error_msg = str(exc_info.value).lower()
                
                # Must include helpful information
                assert 'clickhouse' in error_msg, (
                    f"Error message for '{error_text}' must mention ClickHouse"
                )
                assert 'localhost' in error_msg or 'host' in error_msg or 'port' in error_msg, (
                    f"Error message for '{error_text}' must include connection details"
                )
                assert 'running' in error_msg or 'accessible' in error_msg, (
                    f"Error message for '{error_text}' must suggest checking if server is running"
                )

    def test_timeout_configuration_from_environment(self):
        """
        Verifies that timeout configuration respects environment variables.
        
        This ensures the timeout mechanism is configurable and working.
        """
        test_cases = [
            ('5', 5),
            ('10', 10),
            ('1', 1),  # Very short timeout
        ]
        
        for env_value, expected_value in test_cases:
            with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
                mock_client = MagicMock()
                mock_client_class.return_value = mock_client
                mock_client.execute.return_value = [(1,)]
                
                with patch.dict(os.environ, {'CLICKHOUSE_CONNECT_TIMEOUT': env_value}):
                    get_clickhouse_client()
                
                call_kwargs = mock_client_class.call_args[1]
                assert call_kwargs['connect_timeout'] == expected_value, (
                    f"Expected connect_timeout={expected_value}, got {call_kwargs['connect_timeout']}"
                )

    def test_socket_timeout_error_converted_to_timeout_error(self):
        """
        Verifies that clickhouse_driver's SocketTimeoutError is properly converted.
        
        This is the exact error type that was failing in the original bug.
        """
        try:
            from clickhouse_driver.errors import SocketTimeoutError
            
            with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
                mock_client = MagicMock()
                mock_client_class.return_value = mock_client
                
                # This is the exact error that was raised in the original bug
                mock_client.execute.side_effect = SocketTimeoutError("Code: 209. (localhost:8123)")
                
                with pytest.raises(TimeoutError) as exc_info:
                    get_clickhouse_client()
                
                # Must be TimeoutError, not SocketTimeoutError or generic Exception
                assert isinstance(exc_info.value, TimeoutError), (
                    "SocketTimeoutError must be converted to TimeoutError for consistency"
                )
                assert not isinstance(exc_info.value, SocketTimeoutError), (
                    "Should not raise SocketTimeoutError directly"
                )
                
                # Error message must be user-friendly
                error_msg = str(exc_info.value)
                assert "timeout" in error_msg.lower()
                assert "ClickHouse" in error_msg
        except ImportError:
            pytest.skip("clickhouse_driver.errors.SocketTimeoutError not available")

    def test_no_hanging_on_connection_failure(self):
        """
        CRITICAL: Verifies that connection failures don't hang.
        
        The original signal-based approach could cause hangs or confusing errors.
        This test ensures failures are fast and clear.
        """
        import time
        
        with patch('ohlcv_caller_coverage.ClickHouseClient') as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            
            # Simulate a slow-failing connection (like a real timeout)
            def slow_fail(*args, **kwargs):
                time.sleep(0.1)  # Simulate network delay
                raise TimeoutError("Connection timed out")
            
            mock_client.execute.side_effect = slow_fail
            
            start_time = time.time()
            
            with pytest.raises(TimeoutError):
                get_clickhouse_client()
            
            elapsed = time.time() - start_time
            
            # Should fail quickly (within 0.5 seconds including overhead)
            assert elapsed < 0.5, (
                f"Connection failure should be fast, but took {elapsed:.2f}s. "
                "This might indicate signal handler or blocking issues."
            )


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

