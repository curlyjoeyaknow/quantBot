# Grant OPTIMIZE Privileges to quantbot_app

## Quick Method

1. **Connect to ClickHouse container:**

   ```bash
   docker exec -it quantbot-clickhouse clickhouse-client
   ```

2. **If it asks for a password**, try one of these:
   - The password from your `.env` file (`CLICKHOUSE_PASSWORD`)
   - Or press Enter if no password is set
   - Or try: `UxdtDJVj` (from docker-compose.yml default)

3. **Once connected, run these SQL commands:**

   ```sql
   GRANT OPTIMIZE ON quantbot.ohlcv_candles_1m TO quantbot_app;
   GRANT OPTIMIZE ON quantbot.ohlcv_candles_5m TO quantbot_app;
   SHOW GRANTS FOR quantbot_app;
   ```

4. **Verify** - You should see `OPTIMIZE` in the grants list.

## Alternative: If you know the default user password

If you know the password for the `default` user, you can run:

```bash
docker exec quantbot-clickhouse clickhouse-client \
  --user=default \
  --password="YOUR_PASSWORD_HERE" \
  --multiline <<'EOF'
GRANT OPTIMIZE ON quantbot.ohlcv_candles_1m TO quantbot_app;
GRANT OPTIMIZE ON quantbot.ohlcv_candles_5m TO quantbot_app;
SHOW GRANTS FOR quantbot_app;
EOF
```

## After granting privileges

Run the deduplication sweep:

```bash
quantbot ohlcv dedup-sweep
```

It should now work without privilege errors!
