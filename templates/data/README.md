# Alerts Data Format

This directory contains the `alerts.json` file that feeds data into the dashboard.

## File Structure

The `alerts.json` file should contain an array of alert objects with the following structure:

\`\`\`json
[
  {
    "id": "unique-alert-id",
    "timestamp": "2025-01-29T10:30:00Z",
    "creator": "SniperBot_Alpha",
    "token": "Pepe",
    "tokenSymbol": "PEPE",
    "action": "buy",
    "confidence": 0.85,
    "entryPrice": 0.000012,
    "currentPrice": 0.000015,
    "status": "active",
    "pnl": 25.0,
    "pnlPercent": 25.0,
    "athPrice": 0.000018,
    "maxDrawdown": 8.5,
    "timeToAth": 45
  }
]
\`\`\`

## Field Descriptions

- **id**: Unique identifier for the alert
- **timestamp**: ISO 8601 timestamp when the alert was created
- **creator**: Name of the bot/creator that generated the alert
- **token**: Full name of the token
- **tokenSymbol**: Token ticker symbol
- **action**: Either "buy" or "sell"
- **confidence**: Confidence score between 0 and 1 (e.g., 0.85 = 85%)
- **entryPrice**: Price when the alert was triggered
- **currentPrice**: Current price of the token
- **status**: One of "active", "closed", or "stopped"
- **pnl**: Profit/loss in percentage
- **pnlPercent**: Same as pnl (kept for compatibility)
- **athPrice**: All-time high price reached (optional)
- **maxDrawdown**: Maximum drawdown percentage (optional)
- **timeToAth**: Time to reach ATH in minutes (optional, for closed alerts)

## Updating Data

Simply edit the `alerts.json` file and save it. The dashboard will automatically load the new data on the next API request (refreshes every 3 seconds).

## Tips

- Keep around 20 alerts for optimal performance
- Use ISO 8601 format for timestamps
- Ensure all required fields are present
- PnL should be calculated as: `((currentPrice - entryPrice) / entryPrice) * 100` for buys
