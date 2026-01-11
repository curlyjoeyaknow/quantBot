#!/usr/bin/env python3
"""
Caller Group Management CLI

Create, list, and manage caller groups for backtesting.

Usage:
  # List all caller groups
  python3 manage_caller_groups.py list

  # Show details of a group
  python3 manage_caller_groups.py show --name top_callers

  # Create a group from top callers
  python3 manage_caller_groups.py create-from-top \
    --name top_20 \
    --description "Top 20 callers by volume" \
    --top-n 20 \
    --min-calls 10 \
    --from 2025-12-01 --to 2025-12-24

  # Create a group from a list of caller IDs
  python3 manage_caller_groups.py create \
    --name my_callers \
    --description "My selected callers" \
    --callers "caller1,caller2,caller3"

  # Create from a file (one caller per line)
  python3 manage_caller_groups.py create \
    --name my_callers \
    --description "From file" \
    --callers-file callers.txt

  # Delete a group
  python3 manage_caller_groups.py delete --name old_group

  # List callers from DuckDB with stats
  python3 manage_caller_groups.py list-callers --min-calls 10 --top 50
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.caller_groups import (
    CallerGroup,
    create_group_from_top_callers,
    delete_caller_group,
    get_callers_from_duckdb,
    list_caller_groups,
    load_caller_group,
    save_caller_group,
)
from lib.helpers import parse_yyyy_mm_dd

UTC = timezone.utc


def cmd_list(args: argparse.Namespace) -> None:
    """List all caller groups."""
    groups = list_caller_groups()
    
    if not groups:
        print("No caller groups found.")
        print(f"Groups directory: {Path(__file__).parent / 'caller_groups'}")
        return
    
    print(f"{'Name':<30} {'Callers':>10} {'Created':<20}")
    print("-" * 65)
    
    for name in groups:
        group = load_caller_group(name)
        if group:
            created = group.created_at.strftime("%Y-%m-%d %H:%M")
            print(f"{name:<30} {len(group.caller_ids):>10} {created:<20}")


def cmd_show(args: argparse.Namespace) -> None:
    """Show details of a caller group."""
    group = load_caller_group(args.name)
    
    if group is None:
        print(f"Group not found: {args.name}", file=sys.stderr)
        sys.exit(1)
    
    if args.json:
        print(json.dumps(group.to_dict(), indent=2, default=str))
        return
    
    print(f"Name: {group.name}")
    print(f"Description: {group.description}")
    print(f"Created: {group.created_at.isoformat()}")
    print(f"Callers: {len(group.caller_ids)}")
    
    if group.metadata:
        print(f"Metadata: {json.dumps(group.metadata, indent=2)}")
    
    print()
    print("Caller IDs:")
    for caller_id in sorted(group.caller_ids):
        print(f"  - {caller_id}")


def cmd_create(args: argparse.Namespace) -> None:
    """Create a caller group from a list."""
    callers = set()
    
    if args.callers:
        for c in args.callers.split(","):
            c = c.strip()
            if c:
                callers.add(c)
    
    if args.callers_file:
        with open(args.callers_file) as f:
            for line in f:
                c = line.strip()
                if c and not c.startswith("#"):
                    callers.add(c)
    
    if not callers:
        print("No callers provided. Use --callers or --callers-file", file=sys.stderr)
        sys.exit(1)
    
    group = CallerGroup(
        name=args.name,
        description=args.description or "",
        caller_ids=callers,
    )
    
    path = save_caller_group(group)
    print(f"Created group '{args.name}' with {len(callers)} callers")
    print(f"Saved to: {path}")


def cmd_create_from_top(args: argparse.Namespace) -> None:
    """Create a caller group from top callers in DuckDB."""
    date_from = parse_yyyy_mm_dd(args.date_from) if args.date_from else None
    date_to = parse_yyyy_mm_dd(args.date_to) if args.date_to else None
    
    group = create_group_from_top_callers(
        duckdb_path=args.duckdb,
        group_name=args.name,
        description=args.description or f"Top {args.top_n} callers",
        top_n=args.top_n,
        min_calls=args.min_calls,
        date_from=date_from,
        date_to=date_to,
    )
    
    print(f"Created group '{args.name}' with {len(group.caller_ids)} callers")
    print(f"Top {args.top_n} callers with >= {args.min_calls} calls")
    if date_from:
        print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d') if date_to else 'now'}")


def cmd_delete(args: argparse.Namespace) -> None:
    """Delete a caller group."""
    if not args.force:
        group = load_caller_group(args.name)
        if group is None:
            print(f"Group not found: {args.name}", file=sys.stderr)
            sys.exit(1)
        
        print(f"Deleting group: {args.name}")
        print(f"  Callers: {len(group.caller_ids)}")
        print(f"  Created: {group.created_at.isoformat()}")
        
        confirm = input("Type 'yes' to confirm: ")
        if confirm.lower() != "yes":
            print("Cancelled.")
            return
    
    if delete_caller_group(args.name):
        print(f"Deleted group: {args.name}")
    else:
        print(f"Group not found: {args.name}", file=sys.stderr)
        sys.exit(1)


def cmd_list_callers(args: argparse.Namespace) -> None:
    """List callers from DuckDB with stats."""
    date_from = parse_yyyy_mm_dd(args.date_from) if args.date_from else None
    date_to = parse_yyyy_mm_dd(args.date_to) if args.date_to else None
    
    callers = get_callers_from_duckdb(
        duckdb_path=args.duckdb,
        min_calls=args.min_calls,
        date_from=date_from,
        date_to=date_to,
    )
    
    if not callers:
        print("No callers found matching criteria.")
        return
    
    if args.json:
        print(json.dumps(callers[:args.top] if args.top else callers, indent=2))
        return
    
    print(f"{'Rank':>5} {'Caller':<35} {'Calls':>8} {'First Seen':<12} {'Last Seen':<12}")
    print("-" * 80)
    
    for i, c in enumerate(callers[:args.top] if args.top else callers, 1):
        caller = c["caller"][:34]
        first = c["first_seen"][:10]
        last = c["last_seen"][:10]
        print(f"{i:>5} {caller:<35} {c['count']:>8} {first:<12} {last:<12}")
    
    if args.top and len(callers) > args.top:
        print(f"\n(showing top {args.top} of {len(callers)} callers)")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Manage caller groups for backtesting",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    
    # Common arguments
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"),
                   help="DuckDB database path")
    
    subparsers = ap.add_subparsers(dest="command", help="Command to run")
    
    # List command
    list_p = subparsers.add_parser("list", help="List all caller groups")
    list_p.set_defaults(func=cmd_list)
    
    # Show command
    show_p = subparsers.add_parser("show", help="Show details of a caller group")
    show_p.add_argument("--name", required=True, help="Group name")
    show_p.add_argument("--json", action="store_true", help="Output as JSON")
    show_p.set_defaults(func=cmd_show)
    
    # Create command
    create_p = subparsers.add_parser("create", help="Create a caller group from a list")
    create_p.add_argument("--name", required=True, help="Group name")
    create_p.add_argument("--description", help="Group description")
    create_p.add_argument("--callers", help="Comma-separated caller IDs")
    create_p.add_argument("--callers-file", help="File with caller IDs (one per line)")
    create_p.set_defaults(func=cmd_create)
    
    # Create from top command
    top_p = subparsers.add_parser("create-from-top", help="Create group from top callers")
    top_p.add_argument("--name", required=True, help="Group name")
    top_p.add_argument("--description", help="Group description")
    top_p.add_argument("--top-n", type=int, default=20, help="Number of top callers")
    top_p.add_argument("--min-calls", type=int, default=10, help="Minimum calls required")
    top_p.add_argument("--from", dest="date_from", help="Start date (YYYY-MM-DD)")
    top_p.add_argument("--to", dest="date_to", help="End date (YYYY-MM-DD)")
    top_p.set_defaults(func=cmd_create_from_top)
    
    # Delete command
    del_p = subparsers.add_parser("delete", help="Delete a caller group")
    del_p.add_argument("--name", required=True, help="Group name")
    del_p.add_argument("--force", "-f", action="store_true", help="Skip confirmation")
    del_p.set_defaults(func=cmd_delete)
    
    # List callers command
    callers_p = subparsers.add_parser("list-callers", help="List callers from DuckDB")
    callers_p.add_argument("--min-calls", type=int, default=1, help="Minimum calls")
    callers_p.add_argument("--top", type=int, default=50, help="Show top N callers")
    callers_p.add_argument("--from", dest="date_from", help="Start date (YYYY-MM-DD)")
    callers_p.add_argument("--to", dest="date_to", help="End date (YYYY-MM-DD)")
    callers_p.add_argument("--json", action="store_true", help="Output as JSON")
    callers_p.set_defaults(func=cmd_list_callers)
    
    args = ap.parse_args()
    
    if args.command is None:
        ap.print_help()
        sys.exit(1)
    
    args.func(args)


if __name__ == "__main__":
    main()

