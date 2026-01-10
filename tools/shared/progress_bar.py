#!/usr/bin/env python3
"""
Progress Bar Utility Module

A reusable progress bar library for Python scripts that provides:
- Static progress bars that update in place
- Visual histogram bars with filled/unfilled characters
- Real-time ETA calculation based on processing speed
- Customizable prefixes and bar lengths

Usage:
    from tools.shared.progress_bar import ProgressBar
    
    # Initialize progress bar
    progress = ProgressBar(total=1000, prefix="Processing")
    
    # Update progress
    for i in range(1000):
        # ... do work ...
        progress.update(i + 1)
    
    # Or use as context manager
    with ProgressBar(total=1000, prefix="Processing") as progress:
        for i in range(1000):
            # ... do work ...
            progress.update(i + 1)
    
    # Or use the simple function interface
    from tools.shared.progress_bar import print_progress_bar
    print_progress_bar(completed=500, total=1000, prefix="Processing")
"""

import sys
import time
from typing import Optional


class ProgressBar:
    """
    A progress bar that updates in place on stderr.
    
    Features:
    - Visual histogram bar (█ for filled, ░ for unfilled)
    - Real-time ETA calculation
    - Customizable prefix and bar length
    - Automatic start time tracking
    """
    
    def __init__(
        self,
        total: int,
        prefix: str = "Progress",
        bar_length: int = 50,
        update_interval: int = 1,
        stream=sys.stderr
    ):
        """
        Initialize a progress bar.
        
        Args:
            total: Total number of items to process
            prefix: Prefix text for the progress bar (can include dynamic info)
            bar_length: Length of the progress bar in characters
            update_interval: Update progress bar every N items (for performance)
            stream: Output stream (default: sys.stderr)
        """
        self.total = total
        self.prefix = prefix
        self.bar_length = bar_length
        self.update_interval = update_interval
        self.stream = stream
        self.completed = 0
        self.start_time = time.time()
        self.last_update_time = self.start_time
        self._last_printed_length = 0
    
    def update(self, completed: Optional[int] = None, increment: int = 1, prefix: Optional[str] = None):
        """
        Update the progress bar.
        
        Args:
            completed: New completed count (if None, increments by increment)
            increment: Amount to increment if completed is None
            prefix: Optional new prefix (for dynamic prefixes like current month)
        """
        if completed is not None:
            self.completed = completed
        else:
            self.completed += increment
        
        # Update prefix if provided
        if prefix is not None:
            self.prefix = prefix
        
        # Only update display if we've passed the update interval or at completion
        if (self.completed % self.update_interval == 0) or (self.completed >= self.total):
            self._print()
    
    def _print(self):
        """Print the progress bar (internal method)."""
        if self.total == 0:
            return
        
        percent = (self.completed / self.total) * 100
        filled_length = int(self.bar_length * self.completed // self.total)
        
        # Create the bar
        bar = '█' * filled_length + '░' * (self.bar_length - filled_length)
        
        # Calculate ETA
        if self.completed > 0:
            elapsed = time.time() - self.start_time
            if elapsed > 0:
                rate = self.completed / elapsed
                remaining = (self.total - self.completed) / rate if rate > 0 else 0
                if remaining > 3600:
                    eta_str = f"ETA: {int(remaining // 3600)}h {int((remaining % 3600) // 60)}m"
                elif remaining > 60:
                    eta_str = f"ETA: {int(remaining // 60)}m {int(remaining % 60)}s"
                else:
                    eta_str = f"ETA: {int(remaining)}s"
            else:
                eta_str = "ETA: calculating..."
        else:
            eta_str = "ETA: calculating..."
        
        # Print progress bar (using \r to overwrite same line, \033[K to clear to end of line)
        progress_str = f"\r{self.prefix}: [{bar}] {self.completed:,}/{self.total:,} ({percent:.1f}%) | {eta_str}\033[K"
        
        # Track printed length to handle shorter updates
        self._last_printed_length = len(progress_str) - 2  # -2 for \r and \033[K
        
        self.stream.write(progress_str)
        self.stream.flush()
    
    def finish(self):
        """Finish the progress bar (print final state and newline)."""
        self.completed = self.total
        self._print()
        self.stream.write("\n")
        self.stream.flush()
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - finish the progress bar."""
        self.finish()
        return False


def print_progress_bar(
    completed: int,
    total: int,
    prefix: str = "Progress",
    bar_length: int = 50,
    stream=sys.stderr
):
    """
    Simple function interface for printing a progress bar.
    
    This is a stateless function that calculates ETA based on elapsed time
    since the first call. For better control, use the ProgressBar class.
    
    Args:
        completed: Number of completed items
        total: Total number of items
        prefix: Prefix text for the progress bar
        bar_length: Length of the progress bar in characters
        stream: Output stream (default: sys.stderr)
    
    Note: This function uses a module-level start_time variable for ETA calculation.
    For multiple independent progress bars, use the ProgressBar class instead.
    """
    if total == 0:
        return
    
    # Use module-level start_time for ETA calculation
    if not hasattr(print_progress_bar, 'start_time'):
        print_progress_bar.start_time = time.time()
    
    percent = (completed / total) * 100
    filled_length = int(bar_length * completed // total)
    
    # Create the bar
    bar = '█' * filled_length + '░' * (bar_length - filled_length)
    
    # Calculate ETA
    if completed > 0:
        elapsed = time.time() - print_progress_bar.start_time
        if elapsed > 0:
            rate = completed / elapsed
            remaining = (total - completed) / rate if rate > 0 else 0
            if remaining > 3600:
                eta_str = f"ETA: {int(remaining // 3600)}h {int((remaining % 3600) // 60)}m"
            elif remaining > 60:
                eta_str = f"ETA: {int(remaining // 60)}m {int(remaining % 60)}s"
            else:
                eta_str = f"ETA: {int(remaining)}s"
        else:
            eta_str = "ETA: calculating..."
    else:
        eta_str = "ETA: calculating..."
    
    # Print progress bar (using \r to overwrite same line, \033[K to clear to end of line)
    progress_str = f"\r{prefix}: [{bar}] {completed:,}/{total:,} ({percent:.1f}%) | {eta_str}\033[K"
    stream.write(progress_str)
    stream.flush()


def reset_progress_bar_timer():
    """Reset the module-level timer for print_progress_bar function."""
    if hasattr(print_progress_bar, 'start_time'):
        delattr(print_progress_bar, 'start_time')

