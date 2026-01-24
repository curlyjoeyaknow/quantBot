#!/usr/bin/env python3
"""
Periodic Index Sync Daemon - Background process that rebuilds indexes every 30 seconds.

Watches data/ledger/events/ for new part files and rebuilds indexes when new events are detected.
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path
from typing import Dict, Set

from indexer import rebuild_runs_index, rebuild_alerts_index, rebuild_catalog_index


class IndexDaemon:
    """Periodic index sync daemon."""
    
    def __init__(self, interval_seconds: int = 30, verbose: bool = False):
        self.interval_seconds = interval_seconds
        self.verbose = verbose
        self.running = True
        self.last_event_files: Set[Path] = set()
        self.last_check_time: float = time.time()
        self.file_mtimes: Dict[Path, float] = {}  # Track file modification times
        
        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        if self.verbose:
            print(f"\nReceived signal {signum}, shutting down gracefully...")
        self.running = False
    
    def _get_event_files(self) -> Set[Path]:
        """Get all event files in the events directory."""
        from indexer import EVENTS_DIR
        
        event_files: Set[Path] = set()
        if EVENTS_DIR.exists():
            for jsonl_file in EVENTS_DIR.rglob('*.jsonl'):
                event_files.add(jsonl_file)
        return event_files
    
    def _has_new_events(self) -> bool:
        """
        Check if there are new or modified event files since last check.
        
        Uses both file count and modification time (mtime) for robust detection.
        """
        current_files = self._get_event_files()
        current_time = time.time()
        
        # Check for new files
        new_files = current_files - self.last_event_files
        if new_files:
            if self.verbose:
                print(f"  New files detected: {len(new_files)}")
            return True
        
        # Check if any existing files have been modified (mtime changed)
        modified_files = []
        for file_path in current_files:
            try:
                current_mtime = file_path.stat().st_mtime
                last_mtime = self.file_mtimes.get(file_path, 0)
                
                # File was modified since last check (with 1s tolerance for clock skew)
                if current_mtime > last_mtime + 1.0:
                    modified_files.append(file_path)
                    self.file_mtimes[file_path] = current_mtime
            except (OSError, FileNotFoundError):
                # File was deleted or inaccessible - skip it
                continue
        
        if modified_files:
            if self.verbose:
                print(f"  Modified files detected: {len(modified_files)}")
            return True
        
        # Update mtimes for all current files (in case we missed any)
        for file_path in current_files:
            try:
                self.file_mtimes[file_path] = file_path.stat().st_mtime
            except (OSError, FileNotFoundError):
                pass
        
        self.last_check_time = current_time
        return False
    
    def run(self):
        """Run the daemon loop."""
        if self.verbose:
            print(f"Index daemon started (interval: {self.interval_seconds}s)")
            print("Press Ctrl+C to stop")
        
        # Initial index rebuild
        if self.verbose:
            print("Performing initial index rebuild...")
        try:
            rebuild_runs_index()
            rebuild_alerts_index()
            rebuild_catalog_index()
            self.last_event_files = self._get_event_files()
            # Initialize mtimes for all current files
            for file_path in self.last_event_files:
                try:
                    self.file_mtimes[file_path] = file_path.stat().st_mtime
                except (OSError, FileNotFoundError):
                    pass
            if self.verbose:
                print("Initial index rebuild complete")
        except Exception as e:
            print(f"Error during initial rebuild: {e}", file=sys.stderr)
        
        # Main loop
        while self.running:
            try:
                # Check for new events
                if self._has_new_events():
                    if self.verbose:
                        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] New events detected, rebuilding indexes...")
                    
                    try:
                        rebuild_runs_index()
                        rebuild_alerts_index()
                        rebuild_catalog_index()
                        # Update tracked files after successful rebuild
                        self.last_event_files = self._get_event_files()
                        # Update mtimes for all current files
                        for file_path in self.last_event_files:
                            try:
                                self.file_mtimes[file_path] = file_path.stat().st_mtime
                            except (OSError, FileNotFoundError):
                                pass
                        
                        if self.verbose:
                            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Indexes rebuilt successfully")
                    except Exception as e:
                        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Error rebuilding indexes: {e}", file=sys.stderr)
                
                # Sleep until next check
                time.sleep(self.interval_seconds)
            
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Unexpected error in daemon loop: {e}", file=sys.stderr)
                time.sleep(self.interval_seconds)
        
        if self.verbose:
            print("Index daemon stopped")


def main():
    parser = argparse.ArgumentParser(description='Periodic index sync daemon')
    parser.add_argument('--interval', type=int, default=30, help='Sync interval in seconds (default: 30)')
    parser.add_argument('--verbose', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    daemon = IndexDaemon(interval_seconds=args.interval, verbose=args.verbose)
    daemon.run()


if __name__ == '__main__':
    main()

