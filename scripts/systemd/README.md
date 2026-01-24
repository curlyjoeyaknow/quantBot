# Systemd Services

This directory contains systemd service files for QuantBot services.

## DuckDB Write Queue Worker

The DuckDB write queue worker processes write operations to DuckDB sequentially, preventing lock conflicts when multiple processes need to write.

### Installation

1. Copy the service file to systemd directory:
```bash
sudo cp scripts/systemd/quantbot-duckdb-write-queue.service /etc/systemd/system/
```

2. Reload systemd:
```bash
sudo systemctl daemon-reload
```

3. Enable and start the service:
```bash
sudo systemctl enable quantbot-duckdb-write-queue.service
sudo systemctl start quantbot-duckdb-write-queue.service
```

### Management

- **Check status**: `sudo systemctl status quantbot-duckdb-write-queue`
- **View logs**: `sudo journalctl -u quantbot-duckdb-write-queue -f`
- **Stop**: `sudo systemctl stop quantbot-duckdb-write-queue`
- **Restart**: `sudo systemctl restart quantbot-duckdb-write-queue`
- **Disable**: `sudo systemctl disable quantbot-duckdb-write-queue`

### Queue Management

- **Check queue status**: `python3 tools/backtest/lib/write_queue.py status`
- **Cleanup old jobs**: `python3 tools/backtest/lib/write_queue.py cleanup --max-age 24`
- **Retry failed jobs**: `python3 tools/backtest/lib/write_queue.py retry`

### Configuration

The service runs as user `memez` with:
- Poll interval: 1.0 seconds
- Working directory: `/home/memez/backups/quantBot-consolidation-work`
- Queue directory: `data/.duckdb_write_queue/`
- Auto-restart on failure (5 second delay)

### Troubleshooting

If the service fails to start:
1. Check logs: `sudo journalctl -u quantbot-duckdb-write-queue -n 50`
2. Verify Python path: `which python3`
3. Verify working directory exists and is accessible
4. Check queue directory permissions: `ls -la data/.duckdb_write_queue/`

