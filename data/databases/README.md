# Database Files

This directory contains all SQLite database files used by the application.

## Database Files

- `simulations.db` - Simulation runs, strategies, and user data
- `quantbot.db` - Main application database
- `caller_alerts.db` - Caller alerts and tracking
- `dashboard_metrics.db` - Dashboard metrics and analytics
- `strategy_results.db` - Strategy optimization results
- `tokens.db` - Token metadata cache
- `unified_calls.db` - Unified caller data

## Backup

These files are excluded from git (see `.gitignore`). To backup:

```bash
tar -czf databases-backup-$(date +%Y%m%d).tar.gz data/databases/
```

## Migration

If you have existing `.db` files in the root directory, move them here:

```bash
mv *.db data/databases/
```

