#!/usr/bin/env python3
"""
Helper script to prepare existing trades data from pasted text.
Paste your trade data and it will save to existing_trades.txt
"""

import sys
from pathlib import Path

def main():
    print("=" * 80)
    print("Prepare Existing Trades Data")
    print("=" * 80)
    print("\nPaste your existing trades data (tab-separated).")
    print("Press Ctrl+D (Linux/Mac) or Ctrl+Z then Enter (Windows) when done.")
    print("Or type 'END' on a new line to finish.\n")
    
    lines = []
    try:
        while True:
            line = input()
            if line.strip().upper() == 'END':
                break
            lines.append(line)
    except EOFError:
        pass
    
    if not lines:
        print("No data entered. Exiting.")
        return
    
    # Write to file
    output_file = Path(__file__).parent / "existing_trades.txt"
    with open(output_file, 'w') as f:
        f.write('\n'.join(lines))
    
    print(f"\nSaved {len(lines)} lines to {output_file}")
    print("You can now run: python3 generate-remaining-trades.py")

if __name__ == "__main__":
    main()

