#!/usr/bin/env python3
"""
Example usage of the ProgressBar utility.

This demonstrates different ways to use the progress bar in your Python scripts.
"""

import sys
import time
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from progress_bar import ProgressBar, print_progress_bar


def example_class_context_manager():
    """Example using ProgressBar as a context manager (recommended)."""
    print("Example 1: Using ProgressBar as context manager", file=sys.stderr)
    
    total = 100
    with ProgressBar(total=total, prefix="Processing items", update_interval=5) as progress:
        for i in range(total):
            time.sleep(0.01)  # Simulate work
            progress.update(i + 1)
    
    print("", file=sys.stderr)


def example_class_manual():
    """Example using ProgressBar with manual control."""
    print("Example 2: Using ProgressBar with manual control", file=sys.stderr)
    
    total = 50
    progress = ProgressBar(total=total, prefix="Batch processing")
    
    for i in range(total):
        time.sleep(0.01)  # Simulate work
        progress.update(i + 1)
        # Update prefix dynamically
        if i % 10 == 0:
            progress.update(prefix=f"Processing batch {i // 10 + 1}")
    
    progress.finish()
    print("", file=sys.stderr)


def example_function_interface():
    """Example using the simple function interface."""
    print("Example 3: Using simple function interface", file=sys.stderr)
    
    total = 75
    for i in range(total):
        time.sleep(0.01)  # Simulate work
        print_progress_bar(i + 1, total, prefix="Simple progress")
    
    print("", file=sys.stderr)


def example_large_dataset():
    """Example with a large dataset and dynamic prefix updates."""
    print("Example 4: Large dataset with dynamic prefixes", file=sys.stderr)
    
    months = ['2025-05', '2025-06', '2025-07', '2025-08']
    items_per_month = 250
    total = len(months) * items_per_month
    
    with ProgressBar(total=total, prefix="Initializing", update_interval=10) as progress:
        completed = 0
        for month in months:
            for i in range(items_per_month):
                time.sleep(0.001)  # Simulate work
                completed += 1
                progress.update(completed, prefix=f"Processing {month}")
    
    print("", file=sys.stderr)


if __name__ == '__main__':
    print("ProgressBar Utility Examples\n", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    
    example_class_context_manager()
    example_class_manual()
    example_function_interface()
    example_large_dataset()
    
    print("=" * 60, file=sys.stderr)
    print("All examples completed!", file=sys.stderr)

