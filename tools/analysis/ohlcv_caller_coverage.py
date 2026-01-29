#!/usr/bin/env python3
"""
OHLCV Caller Coverage Matrix

Generates a caller × month coverage matrix showing which callers have OHLCV data
for their calls in each time period. This enables surgical, caller-based fetching.

Matrix format:
                Jul-25  Aug-25  Sep-25  Oct-25  Nov-25  Dec-25
Brook           ████    ████    ████    ████    ████    ██░░
Lsy             ████    ████    ░░░░    ████    ████    ████
Rick            ████    ████    ████    ░░░░    ████    ████
...

Legend:
  ████ = 80-100% coverage (good)
  ███░ = 60-80% coverage (partial)
  ██░░ = 40-60% coverage (gaps)
  █░░░ = 20-40% coverage (poor)
  ░░░░ = 0-20% coverage (missing)

Usage:
    python3 ohlcv_caller_coverage.py  # Default: markdown to data/export/coverage.md
    python3 ohlcv_caller_coverage.py --format table
    python3 ohlcv_caller_coverage.py --format json --output caller_coverage.json
    python3 ohlcv_caller_coverage.py --format markdown --output custom.md
    python3 ohlcv_caller_coverage.py --caller Brook --interval 5m
    
Performance:
    The script uses parallel processing for ClickHouse queries. Configure workers via:
    OHLCV_COVERAGE_WORKERS=16 python3 ohlcv_caller_coverage.py ...
    Default is 8 workers. Increase for faster processing, decrease if ClickHouse is overloaded.
    
Cleanup:
    The script automatically kills any hanging instances before running.
    Disable with --no-kill-hanging if you want to keep existing processes running.
"""

import argparse
import json
import os
import sys
import warnings
import subprocess
import signal
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

# Add workspace root to Python path for tools.shared imports
workspace_root = Path(__file__).resolve().parents[2]
if str(workspace_root) not in sys.path:
    sys.path.insert(0, str(workspace_root))
from threading import Lock

# Suppress deprecation warnings for cleaner JSON output
warnings.filterwarnings('ignore', category=DeprecationWarning)

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_driver import Client as ClickHouseClient  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


def kill_hanging_processes(script_path: str, current_pid: int, verbose: bool = False) -> int:
    """
    Kill any other instances of this script that are currently running.
    
    Returns the number of processes killed.
    """
    killed_count = 0
    
    try:
        # Get the script filename
        script_name = os.path.basename(script_path)
        
        # Find all Python processes running this script
        # Use ps command to find processes
        try:
            # Try ps command (works on Linux/macOS)
            result = subprocess.run(
                ['ps', 'aux'],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            for line in result.stdout.split('\n'):
                if script_name in line and 'python' in line.lower():
                    # Parse PID from ps output (second column)
                    parts = line.split()
                    if len(parts) >= 2:
                        try:
                            pid = int(parts[1])
                            # Skip current process
                            if pid != current_pid:
                                if verbose:
                                    print(f"Found hanging process: PID {pid}", file=sys.stderr, flush=True)
                                
                                # Try graceful termination first (SIGTERM)
                                try:
                                    os.kill(pid, signal.SIGTERM)
                                    if verbose:
                                        print(f"  Sent SIGTERM to PID {pid}, waiting 2 seconds...", file=sys.stderr, flush=True)
                                    
                                    # Wait a bit for graceful shutdown
                                    time.sleep(2)
                                    
                                    # Check if process still exists
                                    try:
                                        os.kill(pid, 0)  # Signal 0 doesn't kill, just checks if process exists
                                        # Process still exists, kill it forcefully
                                        if verbose:
                                            print(f"  Process still running, sending SIGKILL to PID {pid}...", file=sys.stderr, flush=True)
                                        os.kill(pid, signal.SIGKILL)
                                    except ProcessLookupError:
                                        # Process already terminated
                                        pass
                                    
                                    killed_count += 1
                                except ProcessLookupError:
                                    # Process doesn't exist (already terminated)
                                    pass
                                except PermissionError:
                                    if verbose:
                                        print(f"  Permission denied killing PID {pid} (may require sudo)", file=sys.stderr, flush=True)
                        except (ValueError, IndexError):
                            # Skip lines that don't have valid PID
                            continue
        
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            # ps command not available or failed (Windows, etc.)
            # Try alternative method using pgrep/pkill if available
            try:
                result = subprocess.run(
                    ['pgrep', '-f', script_name],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                
                for pid_str in result.stdout.strip().split('\n'):
                    if pid_str.strip():
                        try:
                            pid = int(pid_str.strip())
                            if pid != current_pid:
                                if verbose:
                                    print(f"Found hanging process: PID {pid}", file=sys.stderr, flush=True)
                                
                                try:
                                    os.kill(pid, signal.SIGTERM)
                                    time.sleep(2)
                                    try:
                                        os.kill(pid, 0)
                                        os.kill(pid, signal.SIGKILL)
                                    except ProcessLookupError:
                                        pass
                                    killed_count += 1
                                except (ProcessLookupError, PermissionError):
                                    pass
                        except ValueError:
                            continue
            except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
                # pgrep not available, skip cleanup
                if verbose:
                    print("Warning: Could not check for hanging processes (ps/pgrep not available)", file=sys.stderr, flush=True)
    
    except Exception as e:
        if verbose:
            print(f"Warning: Error while checking for hanging processes: {e}", file=sys.stderr, flush=True)
    
    if killed_count > 0 and verbose:
        print(f"Killed {killed_count} hanging process(es)", file=sys.stderr, flush=True)
    
    return killed_count


def get_duckdb_connection(db_path: str):
    """Get DuckDB connection"""
    from tools.shared.duckdb_adapter import get_readonly_connection
    # Return context manager - caller should use 'with'
    return get_readonly_connection(db_path)


def _check_docker_container_running(container_name: str) -> bool:
    """Check if a Docker container is running"""
    import subprocess
    try:
        result = subprocess.run(
            ['docker', 'ps', '--filter', f'name={container_name}', '--format', '{{.Names}}'],
            capture_output=True,
            text=True,
            timeout=2
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def _check_clickhouse_http_health(host: str, http_port: int = 8123, timeout: int = 3) -> bool:
    """
    Check if ClickHouse is accessible via HTTP ping endpoint.
    
    Returns True if ClickHouse responds to HTTP ping, False otherwise.
    """
    try:
        import urllib.request
        import urllib.error
        
        url = f"http://{host}:{http_port}/ping"
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'quantbot-health-check/1.0')
        
        response = urllib.request.urlopen(req, timeout=timeout)
        return response.getcode() == 200 and response.read().decode().strip() == 'Ok.'
    except Exception:
        return False


def _check_clickhouse_local_service() -> tuple[bool, Optional[str]]:
    """
    Check if ClickHouse is running as a local system service.
    
    Returns:
        tuple: (is_running: bool, service_status: Optional[str])
    """
    import subprocess
    
    try:
        # Check systemd service status
        result = subprocess.run(
            ['systemctl', 'is-active', 'clickhouse-server'],
            capture_output=True,
            text=True,
            timeout=2
        )
        is_active = result.returncode == 0 and result.stdout.strip() == 'active'
        
        if is_active:
            return True, 'active'
        else:
            # Check if service exists but is inactive
            result = subprocess.run(
                ['systemctl', 'status', 'clickhouse-server', '--no-pager'],
                capture_output=True,
                text=True,
                timeout=2
            )
            status = 'inactive' if result.returncode != 0 else 'unknown'
            return False, status
    except FileNotFoundError:
        # systemctl not available (not systemd or not Linux)
        return False, None
    except Exception:
        return False, None


def _start_clickhouse_local_service() -> bool:
    """Attempt to start ClickHouse local service via systemctl"""
    import subprocess
    
    try:
        print("Starting ClickHouse local service...", file=sys.stderr, flush=True)
        result = subprocess.run(
            ['sudo', 'systemctl', 'start', 'clickhouse-server'],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            print("ClickHouse service started. Waiting for it to be ready...", file=sys.stderr, flush=True)
            import time
            time.sleep(3)
            return True
        else:
            print(f"Failed to start ClickHouse service: {result.stderr}", file=sys.stderr, flush=True)
            return False
    except FileNotFoundError:
        # sudo or systemctl not available
        return False
    except subprocess.TimeoutExpired:
        print("Timeout waiting for systemctl to start ClickHouse", file=sys.stderr, flush=True)
        return False
    except Exception as e:
        print(f"Error starting ClickHouse service: {e}", file=sys.stderr, flush=True)
        return False


def _check_clickhouse_process() -> bool:
    """Check if ClickHouse process is running"""
    import subprocess
    
    try:
        result = subprocess.run(
            ['pgrep', '-f', 'clickhouse-server'],
            capture_output=True,
            text=True,
            timeout=2
        )
        return result.returncode == 0 and bool(result.stdout.strip())
    except FileNotFoundError:
        # pgrep not available
        return False
    except Exception:
        return False


def _start_clickhouse_container() -> bool:
    """Attempt to start ClickHouse container via docker-compose"""
    import subprocess
    import os
    
    # Find docker-compose.yml (check current dir and parent dirs)
    compose_file = None
    for dir_path in [os.getcwd(), os.path.dirname(os.getcwd())]:
        candidate = os.path.join(dir_path, 'docker-compose.yml')
        if os.path.exists(candidate):
            compose_file = candidate
            break
    
    if not compose_file:
        return False
    
    try:
        print("Starting ClickHouse container...", file=sys.stderr, flush=True)
        result = subprocess.run(
            ['docker-compose', '-f', compose_file, 'up', '-d', 'clickhouse'],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(compose_file)
        )
        if result.returncode == 0:
            print("ClickHouse container started. Waiting for it to be ready...", file=sys.stderr, flush=True)
            # Wait a bit for the container to be ready
            import time
            time.sleep(5)
            return True
        else:
            print(f"Failed to start ClickHouse: {result.stderr}", file=sys.stderr, flush=True)
            return False
    except FileNotFoundError:
        # docker-compose not found
        return False
    except subprocess.TimeoutExpired:
        print("Timeout waiting for docker-compose to start ClickHouse", file=sys.stderr, flush=True)
        return False
    except Exception as e:
        print(f"Error starting ClickHouse: {e}", file=sys.stderr, flush=True)
        return False


def _try_connect_clickhouse(host: str, port: int, database: str, user: str, password: str, 
                            connect_timeout: int, send_receive_timeout: int) -> Optional[ClickHouseClient]:
    """
    Try to connect to ClickHouse with given parameters.
    
    Returns:
        ClickHouseClient if connection successful, None otherwise
    """
    try:
        if os.getenv('CLICKHOUSE_DEBUG'):
            print(f"DEBUG: Attempting connection to ClickHouse at {host}:{port}", file=sys.stderr, flush=True)
        
        client = ClickHouseClient(
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            connect_timeout=connect_timeout,
            send_receive_timeout=send_receive_timeout
        )
        
        # Test connection
        client.execute('SELECT 1')
        return client
    except Exception:
        return None


def get_clickhouse_client() -> tuple:
    """
    Get ClickHouse client from environment or defaults.
    
    Uses driver's built-in timeout support instead of signals for better
    cross-platform compatibility and cleaner error handling.
    
    Tries multiple connection strategies:
    1. Configured port (default: 19000 for Docker)
    2. If using Docker port (19000) and it fails, try to start container and retry
    3. Try alternate port (9000 for local if using Docker port, or vice versa)
    
    Note: The clickhouse_driver uses the native protocol (port 9000).
    If ClickHouse is running in Docker (docker-compose.yml), the native protocol
    is mapped to port 19000 on the host. Set CLICKHOUSE_PORT=19000 in that case.
    
    Raises:
        ConnectionError: If connection to ClickHouse fails after trying all options
        TimeoutError: If connection times out after trying all options
    
    Returns:
        tuple: (ClickHouseClient, database_name)
    """
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    # Default to 19000 (Docker native protocol) if not set, otherwise use 9000 (local native protocol)
    # The clickhouse_driver uses native protocol, not HTTP
    # Docker-compose maps native protocol (9000) to host port 19000
    # clickhouse_driver uses native protocol (not HTTP)
    # Default ports: 9000 (local), 19000 (Docker)
    # If CLICKHOUSE_PORT is set to HTTP port (8123/18123), map to native protocol port (9000/19000)
    env_port_str = os.getenv('CLICKHOUSE_PORT', '19000')
    env_port = int(env_port_str)
    # Map HTTP ports to native protocol ports
    if env_port == 8123:
        initial_port = 9000  # Local native protocol
    elif env_port == 18123:
        initial_port = 19000  # Docker native protocol
    else:
        initial_port = env_port
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    connect_timeout = int(os.getenv('CLICKHOUSE_CONNECT_TIMEOUT', '5'))  # Default 5 seconds
    send_receive_timeout = int(os.getenv('CLICKHOUSE_SEND_RECEIVE_TIMEOUT', '60'))  # Default 60 seconds
    
    # Try connecting with the configured port first
    client = _try_connect_clickhouse(host, initial_port, database, user, password, connect_timeout, send_receive_timeout)
    if client:
        return client, database
    
    # Connection failed, try recovery strategies
    docker_running = _check_docker_container_running('clickhouse')
    docker_port = 19000
    local_port = 9000
    
    # If using Docker port and container is not running, try to start it
    if initial_port == docker_port and not docker_running:
        print(f"Connection to ClickHouse at {host}:{initial_port} failed. Container not running.", file=sys.stderr, flush=True)
        if _start_clickhouse_container():
            print("Retrying connection to ClickHouse after starting container...", file=sys.stderr, flush=True)
            client = _try_connect_clickhouse(host, initial_port, database, user, password, connect_timeout, send_receive_timeout)
            if client:
                print("Successfully connected to ClickHouse after starting container.", file=sys.stderr, flush=True)
                return client, database
    
    # Try alternate port if initial connection failed
    alternate_port = local_port if initial_port == docker_port else docker_port
    if alternate_port != initial_port:
        print(f"Connection to {host}:{initial_port} failed. Trying alternate port {alternate_port}...", file=sys.stderr, flush=True)
        client = _try_connect_clickhouse(host, alternate_port, database, user, password, connect_timeout, send_receive_timeout)
        if client:
            print(f"Successfully connected to ClickHouse on alternate port {alternate_port}.", file=sys.stderr, flush=True)
            return client, database
    
    # All connection attempts failed, gather diagnostic information
    docker_running = _check_docker_container_running('clickhouse')
    local_service_running, service_status = _check_clickhouse_local_service()
    process_running = _check_clickhouse_process()
    
    # Build diagnostic message
    diagnostics = []
    diagnostics.append("Connection attempts:")
    diagnostics.append(f"  - {host}:{initial_port} (configured)")
    if alternate_port != initial_port:
        diagnostics.append(f"  - {host}:{alternate_port} (alternate port)")
        if host in ('localhost', '127.0.0.1'):
            alternate_host = '127.0.0.1' if host == 'localhost' else 'localhost'
            diagnostics.append(f"  - {alternate_host}:{initial_port} (alternate host)")
            diagnostics.append(f"  - {alternate_host}:{alternate_port} (alternate host+port)")
    
    diagnostics.append("\nDiagnostics:")
    diagnostics.append(f"  - Docker container running: {'Yes' if docker_running else 'No'}")
    diagnostics.append(f"  - Local service status: {service_status if service_status else 'Not available (not systemd or not Linux)'}")
    diagnostics.append(f"  - ClickHouse process running: {'Yes' if process_running else 'No'}")
    
    # Try HTTP health check on both ports
    docker_http_port = 18123
    local_http_port = 8123
    http_docker_ok = _check_clickhouse_http_health(host, docker_http_port, timeout=2)
    http_local_ok = _check_clickhouse_http_health(host, local_http_port, timeout=2)
    diagnostics.append(f"  - HTTP health check (Docker {docker_http_port}): {'OK' if http_docker_ok else 'Failed'}")
    diagnostics.append(f"  - HTTP health check (Local {local_http_port}): {'OK' if http_local_ok else 'Failed'}")
    
    diagnostics.append("\nTroubleshooting steps:")
    if not docker_running:
        diagnostics.append("  1. Start Docker container: docker-compose up -d clickhouse")
    if service_status and not local_service_running:
        diagnostics.append("  2. Start local service: sudo systemctl start clickhouse-server")
    diagnostics.append("  3. Check ClickHouse logs: docker logs clickhouse (Docker) or journalctl -u clickhouse-server (local)")
    diagnostics.append("  4. Verify port configuration:")
    diagnostics.append("     - Docker: CLICKHOUSE_PORT=19000 (native) or 18123 (HTTP)")
    diagnostics.append("     - Local: CLICKHOUSE_PORT=9000 (native) or 8123 (HTTP)")
    
    error_msg = "Failed to connect to ClickHouse after trying multiple connection strategies.\n\n" + "\n".join(diagnostics)
    
    raise ConnectionError(error_msg)


def get_caller_calls_by_month(duckdb_conn, start_month: Optional[str] = None, end_month: Optional[str] = None) -> Dict[str, Dict[str, List[Dict]]]:
    """
    Get all calls grouped by caller and month
    
    Returns:
        {
            'Brook': {
                '2025-11': [{'mint': 'xxx', 'trigger_ts_ms': 123, ...}, ...],
                '2025-12': [...]
            },
            'Lsy': {...}
        }
    """
    
    # Build WHERE clause for date filtering
    where_clauses = []
    if start_month:
        # Validate and normalize month format (YYYY-MM)
        if not start_month or len(start_month) < 7 or start_month.count('-') != 1:
            raise ValueError(
                f"Invalid start-month format: '{start_month}'. Expected YYYY-MM format (e.g., '2025-12'). "
                f"Got: '{start_month}'"
            )
        try:
            start_ts = int(datetime.strptime(start_month + '-01', '%Y-%m-%d').timestamp() * 1000)
            where_clauses.append(f"trigger_ts_ms >= {start_ts}")
        except ValueError as e:
            raise ValueError(
                f"Invalid start-month format: '{start_month}'. Expected YYYY-MM format (e.g., '2025-12'). "
                f"Error: {e}"
            ) from e
    if end_month:
        # Validate and normalize month format (YYYY-MM)
        if not end_month or len(end_month) < 7 or end_month.count('-') != 1:
            raise ValueError(
                f"Invalid end-month format: '{end_month}'. Expected YYYY-MM format (e.g., '2025-12'). "
                f"Got: '{end_month}'"
            )
        try:
            # End of month
            end_date = datetime.strptime(end_month + '-01', '%Y-%m-%d')
            if end_date.month == 12:
                end_date = end_date.replace(year=end_date.year + 1, month=1)
            else:
                end_date = end_date.replace(month=end_date.month + 1)
            end_ts = int(end_date.timestamp() * 1000)
            where_clauses.append(f"trigger_ts_ms < {end_ts}")
        except ValueError as e:
            raise ValueError(
                f"Invalid end-month format: '{end_month}'. Expected YYYY-MM format (e.g., '2025-12'). "
                f"Error: {e}"
            ) from e
    
    where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
    
    query = f"""
    SELECT 
        trigger_from_name as caller,
        strftime(to_timestamp(trigger_ts_ms / 1000), '%Y-%m') as month,
        mint,
        trigger_ts_ms,
        chain
    FROM caller_links_d
    WHERE mint IS NOT NULL 
      AND mint != ''
      AND trigger_from_name IS NOT NULL
      AND trigger_from_name != ''
      {where_sql}
    ORDER BY trigger_from_name, trigger_ts_ms
    """
    
    results = duckdb_conn.execute(query).fetchall()
    
    # Group by caller and month
    caller_data = defaultdict(lambda: defaultdict(list))
    for row in results:
        caller, month, mint, trigger_ts_ms, chain = row
        caller_data[caller][month].append({
            'mint': mint,
            'trigger_ts_ms': trigger_ts_ms,
            'chain': chain or 'solana'
        })
    
    return dict(caller_data)


# Global cache for mint coverage (shared across all coverage checks)
_mint_coverage_cache: Dict[str, bool] = {}
_cache_lock = Lock()  # Thread-safe access to cache


def _create_clickhouse_client() -> ClickHouseClient:
    """
    Create a new ClickHouse client connection (for thread-local use).
    
    This is used for parallel processing where each thread needs its own connection.
    """
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    env_port_str = os.getenv('CLICKHOUSE_PORT', '19000')
    env_port = int(env_port_str)
    # Map HTTP ports to native protocol ports
    if env_port == 8123:
        port = 9000  # Local native protocol
    elif env_port == 18123:
        port = 19000  # Docker native protocol
    else:
        port = env_port
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    connect_timeout = int(os.getenv('CLICKHOUSE_CONNECT_TIMEOUT', '5'))
    send_receive_timeout = int(os.getenv('CLICKHOUSE_SEND_RECEIVE_TIMEOUT', '60'))
    
    # Create client - clickhouse_driver accepts password as parameter
    client = ClickHouseClient(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=connect_timeout,
        send_receive_timeout=send_receive_timeout,
    )
    
    # Test connection to ensure it works
    try:
        client.execute('SELECT 1')
    except Exception as e:
        raise ConnectionError(f"Failed to connect to ClickHouse at {host}:{port}: {e}")
    
    return client


def check_ohlcv_coverage(
    ch_client, 
    database: str, 
    calls: List[Dict], 
    interval: str = '5m', 
    verbose: bool = False,
    coverage_cache: Optional[Dict[str, bool]] = None
) -> Dict[str, Any]:
    """
    Check OHLCV coverage for a list of calls
    
    NOTE: interval filter removed due to ClickHouse 18.16 reserved keyword issue.
    Coverage check now returns true if ANY interval exists for the token.
    
    Uses a coverage_cache to avoid re-querying ClickHouse for the same mints.
    
    Returns:
        {
            'total_calls': 100,
            'calls_with_coverage': 85,
            'coverage_ratio': 0.85,
            'missing_mints': ['xxx', 'yyy']
        }
    """
    
    if not calls:
        return {
            'total_calls': 0,
            'calls_with_coverage': 0,
            'coverage_ratio': 0.0,
            'missing_mints': []
        }
    
    # Use provided cache or global cache (thread-safe access)
    use_global_cache = coverage_cache is None
    cache = coverage_cache if coverage_cache is not None else _mint_coverage_cache
    
    # Get unique mints from calls
    mints = list(set(call['mint'] for call in calls))
    
    if verbose:
        print(f"Checking coverage for {len(mints)} unique mints...", file=sys.stderr, flush=True)
    
    # Check cache for which mints we already know about (thread-safe)
    if use_global_cache:
        with _cache_lock:
            mints_to_query = [m for m in mints if m not in cache]
            mints_with_coverage = {m for m in mints if cache.get(m, False)}
    else:
        mints_to_query = [m for m in mints if m not in cache]
        mints_with_coverage = {m for m in mints if cache.get(m, False)}
    
    if verbose and mints_to_query:
        cached_count = len(mints) - len(mints_to_query)
        if cached_count > 0:
            print(f"  Using cache: {cached_count}/{len(mints)} mints already checked", file=sys.stderr, flush=True)
        print(f"  Querying ClickHouse for {len(mints_to_query)} mints...", file=sys.stderr, flush=True)
    
    # Query ClickHouse only for mints not in cache
    if mints_to_query:
        batch_size = 100
        num_batches = (len(mints_to_query) + batch_size - 1) // batch_size  # Proper ceiling division
        
        for batch_idx, i in enumerate(range(0, len(mints_to_query), batch_size), 1):
            batch = mints_to_query[i:i+batch_size]
            mint_placeholders = ','.join(f"'{m}'" for m in batch)
            
            # Simplified query without interval filter (reserved keyword issue in CH 18.16)
            query = f"""
            SELECT DISTINCT token_address
            FROM {database}.ohlcv_candles
            WHERE token_address IN ({mint_placeholders})
            """
            
            try:
                if verbose:
                    print(f"    Batch {batch_idx}/{num_batches} ({len(batch)} mints)...", file=sys.stderr, flush=True)
                
                results = ch_client.execute(query)
                found_mints = {row[0] for row in results}
                
                # Update cache with results (thread-safe if using global cache)
                if use_global_cache:
                    with _cache_lock:
                        for mint in batch:
                            cache[mint] = mint in found_mints
                            if mint in found_mints:
                                mints_with_coverage.add(mint)
                else:
                    for mint in batch:
                        cache[mint] = mint in found_mints
                        if mint in found_mints:
                            mints_with_coverage.add(mint)
                
                if verbose:
                    print(f"    Batch {batch_idx}/{num_batches}: {len(found_mints)} mints found", file=sys.stderr, flush=True)
            except Exception as e:
                print(f"Warning: ClickHouse query failed for batch {batch_idx}/{num_batches}: {e}", file=sys.stderr, flush=True)
                import traceback
                traceback.print_exc(file=sys.stderr)
                # Mark as not found in cache on error (will retry next time) - thread-safe
                if use_global_cache:
                    with _cache_lock:
                        for mint in batch:
                            if mint not in cache:
                                cache[mint] = False
                else:
                    for mint in batch:
                        if mint not in cache:
                            cache[mint] = False
    
    # Calculate coverage
    calls_with_coverage = sum(1 for call in calls if call['mint'] in mints_with_coverage)
    coverage_ratio = calls_with_coverage / len(calls) if calls else 0.0
    missing_mints = [call['mint'] for call in calls if call['mint'] not in mints_with_coverage]
    
    return {
        'total_calls': len(calls),
        'calls_with_coverage': calls_with_coverage,
        'coverage_ratio': coverage_ratio,
        'missing_mints': list(set(missing_mints))  # Unique missing mints
    }


def build_coverage_matrix(
    duckdb_conn,
    ch_client,
    database: str,
    interval: str = '5m',
    caller_filter: Optional[str] = None,
    start_month: Optional[str] = None,
    end_month: Optional[str] = None,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Build caller × month coverage matrix
    
    Uses a shared coverage cache to avoid re-querying ClickHouse for the same mints.
    This dramatically improves performance when the same mints appear across multiple caller-month combinations.
    
    Returns:
        {
            'callers': ['Brook', 'Lsy', 'Rick'],
            'months': ['2025-07', '2025-08', ...],
            'matrix': {
                'Brook': {
                    '2025-07': {'coverage_ratio': 0.95, 'total_calls': 100, ...},
                    '2025-08': {...}
                },
                ...
            }
        }
    """
    
    # Clear cache at start of analysis (fresh cache for each run)
    global _mint_coverage_cache
    _mint_coverage_cache.clear()
    
    if verbose:
        print("Getting calls from DuckDB...", file=sys.stderr, flush=True)
    
    # Get all calls grouped by caller and month
    caller_calls = get_caller_calls_by_month(duckdb_conn, start_month, end_month)
    
    if verbose:
        print(f"Found {len(caller_calls)} callers", file=sys.stderr, flush=True)
    
    # Filter by caller if specified
    if caller_filter:
        caller_calls = {k: v for k, v in caller_calls.items() if k == caller_filter}
        if verbose:
            print(f"Filtered to caller: {caller_filter}", file=sys.stderr, flush=True)
    
    # Get all unique months
    all_months = set()
    for caller_months in caller_calls.values():
        all_months.update(caller_months.keys())
    months = sorted(list(all_months))
    
    if verbose:
        print(f"Analyzing {len(months)} months: {months}", file=sys.stderr, flush=True)
    
    # Build coverage matrix with parallel processing
    # Create a list of all (caller, month) combinations to process
    tasks: List[Tuple[str, str, List[Dict]]] = []
    for caller, months_data in caller_calls.items():
        for month in months:
            calls = months_data.get(month, [])
            tasks.append((caller, month, calls))
    
    total_cells = len(tasks)
    matrix = {}
    
    # Use parallel processing for I/O-bound ClickHouse queries
    # Allow configurable worker count via environment variable, default to 8
    default_workers = int(os.environ.get('OHLCV_COVERAGE_WORKERS', '8'))
    max_workers = min(default_workers, total_cells)
    
    if verbose:
        print(f"Processing {total_cells} caller-month combinations...", file=sys.stderr, flush=True)
        print(f"Using {max_workers} parallel workers for ClickHouse queries", file=sys.stderr, flush=True)
    
    # Process tasks in parallel
    # Each thread needs its own ClickHouse client (connections are not thread-safe)
    def process_cell(caller: str, month: str, calls: List[Dict]) -> Tuple[str, str, Dict[str, Any]]:
        """Process a single caller-month combination"""
        # Create a new client connection for this thread
        # ClickHouse driver connections are not thread-safe, so each worker needs its own
        thread_client = None
        try:
            thread_client = _create_clickhouse_client()
            coverage = check_ohlcv_coverage(thread_client, database, calls, interval, False, _mint_coverage_cache)
            return (caller, month, coverage)
        finally:
            # Clean up the thread's client connection
            if thread_client:
                try:
                    thread_client.disconnect()
                except Exception:
                    pass  # Ignore cleanup errors
    
    completed = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_task = {
            executor.submit(process_cell, caller, month, calls): (caller, month, len(calls))
            for caller, month, calls in tasks
        }
        
        # Process completed tasks as they finish
        for future in as_completed(future_to_task):
            caller, month, cell_coverage = future.result()
            if caller not in matrix:
                matrix[caller] = {}
            matrix[caller][month] = cell_coverage
            
            completed += 1
            if verbose and completed % 10 == 0:
                print(f"  Progress: {completed}/{total_cells} cells processed", file=sys.stderr, flush=True)
    
    if verbose:
        with _cache_lock:
            cache_size = len(_mint_coverage_cache)
        print("\nCoverage matrix complete!", file=sys.stderr, flush=True)
        print(f"Cache stats: {cache_size} unique mints checked", file=sys.stderr, flush=True)
    
    return {
        'callers': sorted(list(caller_calls.keys())),
        'months': months,
        'matrix': matrix,
        'interval': interval
    }


def format_coverage_cell(coverage_ratio: float) -> str:
    """Format coverage ratio as visual block"""
    if coverage_ratio >= 0.8:
        return '████'  # 80-100%
    elif coverage_ratio >= 0.6:
        return '███░'  # 60-80%
    elif coverage_ratio >= 0.4:
        return '██░░'  # 40-60%
    elif coverage_ratio >= 0.2:
        return '█░░░'  # 20-40%
    else:
        return '░░░░'  # 0-20%


def format_coverage_color(coverage_ratio: float) -> str:
    """Format coverage ratio with percentage"""
    pct = int(coverage_ratio * 100)
    if coverage_ratio >= 0.8:
        return f"{pct:3d}%"  # Good
    elif coverage_ratio >= 0.6:
        return f"{pct:3d}%"  # Partial
    elif coverage_ratio >= 0.4:
        return f"{pct:3d}%"  # Gaps
    elif coverage_ratio >= 0.2:
        return f"{pct:3d}%"  # Poor
    else:
        return f"{pct:3d}%"  # Missing


def generate_markdown_table(coverage_data: Dict[str, Any]) -> str:
    """Generate markdown table format for coverage matrix"""
    
    callers = coverage_data['callers']
    months = coverage_data['months']
    matrix = coverage_data['matrix']
    interval = coverage_data['interval']
    
    lines = []
    
    # Header
    lines.append(f"# OHLCV Caller Coverage Matrix - Interval: {interval}\n")
    
    # Table header
    header_cells = ['Caller']
    for month in months:
        month_obj = datetime.strptime(month, '%Y-%m')
        month_str = month_obj.strftime('%b-%y')
        header_cells.append(month_str)
    
    lines.append('| ' + ' | '.join(header_cells) + ' |')
    lines.append('|' + '|'.join(['---'] * len(header_cells)) + '|')
    
    # Table rows
    for caller in callers:
        row_cells = [caller]
        for month in months:
            coverage = matrix[caller].get(month, {})
            ratio = coverage.get('coverage_ratio', 0.0)
            cell = format_coverage_cell(ratio)
            row_cells.append(cell)
        lines.append('| ' + ' | '.join(row_cells) + ' |')
    
    # Legend
    lines.append('\n**Legend:**\n')
    lines.append('- `████` = 80-100% coverage (good)')
    lines.append('- `███░` = 60-80% coverage (partial)')
    lines.append('- `██░░` = 40-60% coverage (gaps)')
    lines.append('- `█░░░` = 20-40% coverage (poor)')
    lines.append('- `░░░░` = 0-20% coverage (missing)')
    
    return '\n'.join(lines)


def print_coverage_matrix(coverage_data: Dict[str, Any]) -> None:
    """Print coverage matrix in table format"""
    
    callers = coverage_data['callers']
    months = coverage_data['months']
    matrix = coverage_data['matrix']
    interval = coverage_data['interval']
    
    print("\n" + "="*100)
    print(f"OHLCV CALLER COVERAGE MATRIX - Interval: {interval}")
    print("="*100)
    
    # Print legend
    print("\nLegend:")
    print("  ████ = 80-100% coverage (good)")
    print("  ███░ = 60-80% coverage (partial)")
    print("  ██░░ = 40-60% coverage (gaps)")
    print("  █░░░ = 20-40% coverage (poor)")
    print("  ░░░░ = 0-20% coverage (missing)")
    print()
    
    # Print header
    header = f"{'Caller':<20}"
    for month in months:
        # Format as MMM-YY (e.g., Jul-25)
        month_obj = datetime.strptime(month, '%Y-%m')
        month_str = month_obj.strftime('%b-%y')
        header += f" {month_str:>8}"
    print(header)
    print("-" * len(header))
    
    # Print each caller row
    for caller in callers:
        row = f"{caller:<20}"
        for month in months:
            coverage = matrix[caller].get(month, {})
            ratio = coverage.get('coverage_ratio', 0.0)
            cell = format_coverage_cell(ratio)
            row += f" {cell:>8}"
        print(row)
    
    # Print summary statistics
    print("\n" + "="*100)
    print("SUMMARY STATISTICS")
    print("="*100)
    
    for caller in callers:
        total_calls = sum(matrix[caller].get(month, {}).get('total_calls', 0) for month in months)
        total_with_coverage = sum(matrix[caller].get(month, {}).get('calls_with_coverage', 0) for month in months)
        overall_ratio = total_with_coverage / total_calls if total_calls > 0 else 0.0
        
        print(f"\n{caller}:")
        print(f"  Total Calls: {total_calls:,}")
        print(f"  Calls with Coverage: {total_with_coverage:,}")
        print(f"  Overall Coverage: {overall_ratio:.1%}")
        
        # Find months with poor coverage
        poor_months = []
        for month in months:
            coverage = matrix[caller].get(month, {})
            ratio = coverage.get('coverage_ratio', 0.0)
            if ratio < 0.8 and coverage.get('total_calls', 0) > 0:
                poor_months.append((month, ratio, coverage.get('total_calls', 0)))
        
        if poor_months:
            print("  Months needing attention:")
            for month, ratio, calls in poor_months:
                print(f"    {month}: {ratio:.1%} coverage ({calls} calls)")
    
    print("\n" + "="*100)


def generate_surgical_fetch_plan(coverage_data: Dict[str, Any], min_coverage: float = 0.8) -> List[Dict[str, Any]]:
    """
    Generate a surgical fetch plan for callers with poor coverage
    
    Returns list of fetch tasks:
    [
        {
            'caller': 'Brook',
            'month': '2025-11',
            'missing_mints': ['xxx', 'yyy'],
            'total_calls': 50,
            'current_coverage': 0.45
        },
        ...
    ]
    """
    
    matrix = coverage_data['matrix']
    months = coverage_data['months']
    
    fetch_plan = []
    
    for caller, months_data in matrix.items():
        for month in months:
            coverage = months_data.get(month, {})
            ratio = coverage.get('coverage_ratio', 0.0)
            total_calls = coverage.get('total_calls', 0)
            
            if ratio < min_coverage and total_calls > 0:
                fetch_plan.append({
                    'caller': caller,
                    'month': month,
                    'missing_mints': coverage.get('missing_mints', []),
                    'total_calls': total_calls,
                    'calls_with_coverage': coverage.get('calls_with_coverage', 0),
                    'current_coverage': ratio,
                    'priority': (1 - ratio) * total_calls  # Higher priority for more calls with worse coverage
                })
    
    # Sort by priority (descending)
    fetch_plan.sort(key=lambda x: x['priority'], reverse=True)
    
    return fetch_plan


def main():
    parser = argparse.ArgumentParser(description='Analyze OHLCV coverage by caller and month')
    parser.add_argument('--duckdb', default='data/tele.duckdb',
                       help='Path to DuckDB database (default: data/tele.duckdb)')
    parser.add_argument('--format', choices=['table', 'json', 'markdown'], default='markdown',
                       help='Output format (default: markdown)')
    parser.add_argument('--output', help='Output file (default: data/export/coverage.md for markdown)')
    parser.add_argument('--caller', help='Filter by specific caller')
    parser.add_argument('--interval', default='5m',
                       help='OHLCV interval to check (default: 5m)')
    parser.add_argument('--start-month', help='Start month (YYYY-MM format, e.g., 2025-12, not just 12)')
    parser.add_argument('--end-month', help='End month (YYYY-MM format, e.g., 2025-12, not just 12)')
    parser.add_argument('--min-coverage', type=float, default=0.8,
                       help='Minimum coverage threshold for surgical fetch plan (default: 0.8)')
    parser.add_argument('--generate-fetch-plan', action='store_true',
                       help='Generate surgical fetch plan for gaps')
    parser.add_argument('--verbose', action='store_true',
                       help='Show verbose progress output to stderr')
    parser.add_argument('--no-kill-hanging', action='store_true',
                       help='Do not kill hanging instances of this script before running')
    
    args = parser.parse_args()
    
    # Kill hanging processes by default (unless --no-kill-hanging is specified)
    if not args.no_kill_hanging:
        script_path = os.path.abspath(__file__)
        current_pid = os.getpid()
        kill_hanging_processes(script_path, current_pid, verbose=args.verbose)
    
    duckdb_conn = None
    ch_client = None
    
    try:
        # Connect to databases
        duckdb_conn = get_duckdb_connection(args.duckdb)
        
        # Check if ClickHouse is accessible before attempting connection
        if args.verbose:
            print("Connecting to ClickHouse...", file=sys.stderr, flush=True)
        
        ch_client, database = get_clickhouse_client()  # Connection test with timeout is done inside
        
        # Build coverage matrix
        coverage_data = build_coverage_matrix(
            duckdb_conn,
            ch_client,
            database,
            interval=args.interval,
            caller_filter=args.caller,
            start_month=args.start_month,
            end_month=args.end_month,
            verbose=args.verbose
        )
        
        # Generate fetch plan if requested
        fetch_plan = []
        if args.generate_fetch_plan:
            fetch_plan = generate_surgical_fetch_plan(coverage_data, args.min_coverage)
        
        # Output results
        if args.format == 'json':
            output_data = {
                **coverage_data,
                'fetch_plan': fetch_plan if args.generate_fetch_plan else None,
                'metadata': {
                    'generated_at': datetime.utcnow().isoformat(),
                    'duckdb_path': args.duckdb,
                    'interval': args.interval,
                    'caller_filter': args.caller,
                    'start_month': args.start_month,
                    'end_month': args.end_month
                }
            }
            
            output = json.dumps(output_data, indent=2)
            if args.output:
                with open(args.output, 'w') as f:
                    f.write(output)
                print(f"Coverage data written to {args.output}", file=sys.stderr, flush=True)
            else:
                print(output, flush=True)
        elif args.format == 'markdown':
            # Default output file for markdown
            output_file = args.output or 'data/export/coverage.md'
            
            # Ensure directory exists
            output_dir = os.path.dirname(output_file)
            if output_dir and not os.path.exists(output_dir):
                os.makedirs(output_dir, exist_ok=True)
            
            # Generate markdown
            markdown_output = generate_markdown_table(coverage_data)
            
            # Write to file
            with open(output_file, 'w') as f:
                f.write(markdown_output)
            
            print(f"Coverage data written to {output_file}", file=sys.stderr, flush=True)
        else:  # table format
            print_coverage_matrix(coverage_data)
            
            if args.generate_fetch_plan and fetch_plan:
                print("\n" + "="*100)
                print("SURGICAL FETCH PLAN")
                print("="*100)
                print(f"\nFound {len(fetch_plan)} caller-month combinations needing attention:\n")
                
                for i, task in enumerate(fetch_plan[:20], 1):  # Show top 20
                    print(f"{i}. {task['caller']} - {task['month']}")
                    print(f"   Coverage: {task['current_coverage']:.1%} ({task['calls_with_coverage']}/{task['total_calls']} calls)")
                    print(f"   Missing mints: {len(task['missing_mints'])}")
                    print(f"   Priority score: {task['priority']:.1f}")
                    print()
                
                if len(fetch_plan) > 20:
                    print(f"... and {len(fetch_plan) - 20} more tasks")
                
                print("\nTo fetch OHLCV for a specific caller-month:")
                print("  quantbot ingestion ohlcv --duckdb data/tele.duckdb --caller <name> --from <start> --to <end>")
        
        # Flush stdout to prevent hanging when called from spawn
        sys.stdout.flush()
        sys.stderr.flush()
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        return 1
    finally:
        # Clean up connections
        if duckdb_conn:
            try:
                duckdb_conn.close()
            except Exception:
                pass
        
        if ch_client:
            try:
                ch_client.disconnect()
            except Exception:
                pass


if __name__ == '__main__':
    sys.exit(main())

