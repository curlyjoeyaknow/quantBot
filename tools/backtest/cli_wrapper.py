#!/usr/bin/env python3
"""
Unified CLI wrapper for all backtest operations.

Allows optimization runs to call backtest scripts via command line
instead of importing/rewriting code.

Usage:
    python3 cli_wrapper.py baseline --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb
    python3 cli_wrapper.py strategy --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb --tp 2.0 --sl 0.7
    python3 cli_wrapper.py optimizer --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb --trials 100
    python3 cli_wrapper.py baseline --help  # Show help for baseline command
    python3 cli_wrapper.py opt --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb --trials 100  # Alias for optimizer
"""

import sys
import subprocess
import json
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

# Get the directory containing this script
SCRIPT_DIR = Path(__file__).resolve().parent

# Command aliases
ALIASES = {
    "opt": "optimizer",
    "optimize": "optimizer",
    "backtest": "strategy",
    "bt": "strategy",
    "bl": "baseline",
}

def load_config_file(config_path: Path) -> Optional[Dict[str, Any]]:
    """Load configuration from JSON file."""
    if not config_path.exists():
        return None
    
    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Warning: Failed to load config file {config_path}: {e}", file=sys.stderr)
        return None

def merge_config_args(config: Dict[str, Any], args: List[str]) -> List[str]:
    """Merge config file values with command-line args (args take precedence)."""
    merged = []
    
    # Convert config dict to args format
    for key, value in config.items():
        # Convert underscores to hyphens for CLI args
        arg_key = key.replace("_", "-")
        
        if isinstance(value, bool):
            if value:
                merged.append(f"--{arg_key}")
        elif isinstance(value, (int, float)):
            merged.extend([f"--{arg_key}", str(value)])
        elif isinstance(value, str):
            merged.extend([f"--{arg_key}", value])
        elif isinstance(value, list):
            for item in value:
                merged.extend([f"--{arg_key}", str(item)])
    
    # Add command-line args (they override config)
    merged.extend(args)
    
    return merged

def show_progress_indicator(process: subprocess.Popen, verbose: bool = False) -> int:
    """Show progress indicator while process runs."""
    import time
    import threading
    
    if not verbose:
        # Simple spinner
        spinner_chars = "|/-\\"
        spinner_idx = 0
        
        def spinner():
            nonlocal spinner_idx
            while process.poll() is None:
                print(f"\r⏳ Running... {spinner_chars[spinner_idx % len(spinner_chars)]}", end="", flush=True)
                spinner_idx += 1
                time.sleep(0.1)
            print("\r" + " " * 50 + "\r", end="")  # Clear line
        
        spinner_thread = threading.Thread(target=spinner, daemon=True)
        spinner_thread.start()
        spinner_thread.join(timeout=0.1)
    
    return process.wait()

def run_baseline(args, config: Optional[Dict[str, Any]] = None, show_progress: bool = False):
    """Run baseline backtest."""
    script_path = SCRIPT_DIR / "run_baseline_all.py"
    final_args = merge_config_args(config, args) if config else args
    cmd = [sys.executable, str(script_path)] + final_args
    
    if show_progress:
        process = subprocess.Popen(cmd)
        returncode = show_progress_indicator(process, verbose="--verbose" in final_args or "-v" in final_args)
        return subprocess.CompletedProcess(cmd, returncode)
    else:
        return subprocess.run(cmd, check=False)

def run_strategy(args, config: Optional[Dict[str, Any]] = None, show_progress: bool = False):
    """Run strategy backtest."""
    script_path = SCRIPT_DIR / "run_strategy.py"
    final_args = merge_config_args(config, args) if config else args
    cmd = [sys.executable, str(script_path)] + final_args
    
    if show_progress:
        process = subprocess.Popen(cmd)
        returncode = show_progress_indicator(process, verbose="--verbose" in final_args or "-v" in final_args)
        return subprocess.CompletedProcess(cmd, returncode)
    else:
        return subprocess.run(cmd, check=False)

def run_optimizer(args, config: Optional[Dict[str, Any]] = None, show_progress: bool = False):
    """Run optimizer."""
    script_path = SCRIPT_DIR / "run_random_search.py"
    final_args = merge_config_args(config, args) if config else args
    cmd = [sys.executable, str(script_path)] + final_args
    
    if show_progress:
        process = subprocess.Popen(cmd)
        returncode = show_progress_indicator(process, verbose="--verbose" in final_args or "-v" in final_args)
        return subprocess.CompletedProcess(cmd, returncode)
    else:
        return subprocess.run(cmd, check=False)

def main():
    if len(sys.argv) < 2:
        print("Usage: cli_wrapper.py <command> [args...] [--config <file>] [--progress]")
        print("\nCommands:")
        print("  baseline  - Run baseline backtest (pure path metrics)")
        print("  strategy  - Run strategy backtest (TP/SL simulation)")
        print("  optimizer - Run optimization (random search)")
        print("\nCommand Aliases:")
        print("  opt, optimize - alias for optimizer")
        print("  backtest, bt  - alias for strategy")
        print("  bl            - alias for baseline")
        print("\nOptions:")
        print("  --config <file>  - Load configuration from JSON file")
        print("  --progress       - Show progress indicator during execution")
        print("\nExamples:")
        print("  python3 cli_wrapper.py baseline --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb")
        print("  python3 cli_wrapper.py strategy --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb --tp 2.0 --sl 0.7")
        print("  python3 cli_wrapper.py optimizer --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb --trials 100")
        print("  python3 cli_wrapper.py baseline --config config.json --progress")
        print("  python3 cli_wrapper.py baseline --help  # Show help for baseline command")
        print("\nUse --help with any command to see full options:")
        print("  python3 cli_wrapper.py baseline --help")
        print("  python3 cli_wrapper.py strategy --help")
        print("  python3 cli_wrapper.py optimizer --help")
        sys.exit(1)
    
    command = sys.argv[1]
    args = sys.argv[2:]
    
    # Handle command aliases
    if command in ALIASES:
        command = ALIASES[command]
    
    # Parse wrapper-specific options
    config_path = None
    show_progress = False
    filtered_args = []
    
    i = 0
    while i < len(args):
        if args[i] == "--config" and i + 1 < len(args):
            config_path = Path(args[i + 1])
            i += 2
        elif args[i] == "--progress":
            show_progress = True
            i += 1
        else:
            filtered_args.append(args[i])
            i += 1
    
    # Load config file if specified
    config = None
    if config_path:
        config = load_config_file(config_path)
        if config is None:
            print(f"Error: Config file not found: {config_path}", file=sys.stderr)
            sys.exit(1)
    
    # Handle --help for commands
    if "--help" in filtered_args or "-h" in filtered_args:
        if command == "baseline":
            result = run_baseline(["--help"])
        elif command == "strategy":
            result = run_strategy(["--help"])
        elif command == "optimizer":
            result = run_optimizer(["--help"])
        else:
            print(f"Unknown command: {command}")
            print("Available commands: baseline, strategy, optimizer")
            sys.exit(1)
        sys.exit(result.returncode)
    
    # Run command
    try:
        if command == "baseline":
            result = run_baseline(filtered_args, config=config, show_progress=show_progress)
        elif command == "strategy":
            result = run_strategy(filtered_args, config=config, show_progress=show_progress)
        elif command == "optimizer":
            result = run_optimizer(filtered_args, config=config, show_progress=show_progress)
        else:
            print(f"Unknown command: {command}")
            print("Available commands: baseline, strategy, optimizer")
            print("Use --help to see command aliases")
            sys.exit(1)
        
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        print("\n\nInterrupted by user", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

