# Depth Analyzer Wrapper Script

A helper script to automatically detect available timestamps and run the `depth-analyzer` tool.

## Features

- 🔍 Automatically scans for transaction files and extracts timestamps
- 📅 Lists all available timestamps with formatted dates
- 🚀 Auto-selects the latest timestamp if none specified
- ✅ Validates timestamp format and existence
- 🎨 Color-coded output for better readability

## Usage

### Basic Usage (Auto-select latest)

```bash
./scripts/depth-analyzer-wrapper.sh analytics/transaction-history/
```

### Specify Custom Input Directory

```bash
./scripts/depth-analyzer-wrapper.sh /path/to/transaction-history/
```

### Specify Custom Timestamp

```bash
./scripts/depth-analyzer-wrapper.sh analytics/transaction-history/ 20251111-004453
```

### Set Custom depth-analyzer Path

```bash
export DEPTH_ANALYZER_PATH=/custom/path/to/depth-analyzer
./scripts/depth-analyzer-wrapper.sh analytics/transaction-history/
```

## Output

The script will:
1. Scan the input directory for transaction files
2. Extract and list all available timestamps
3. Auto-select the latest timestamp (or use the one you specify)
4. Run `depth-analyzer` with the correct arguments
5. Display the results

## Example Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Depth Analyzer Wrapper
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 Scanning for transaction files in: analytics/transaction-history/
✅ Found 3 unique timestamp(s):

   1. 20251110-120000 (2025-11-10 12:00:00)
   2. 20251111-004453 (2025-11-11 00:44:53)
   3. 20251111-120000 (2025-11-11 12:00:00)

📅 Auto-selected latest timestamp: 20251111-120000 (2025-11-11 12:00:00)

🚀 Running depth-analyzer...
   Input: analytics/transaction-history/
   Timestamp: 20251111-120000
```

## Requirements

- `depth-analyzer` binary must be available (default: `./target/release/depth-analyzer`)
- Transaction files must follow naming pattern: `transactions-YYYYMMDD-HHMMSS.csv` or `.json`
- Bash shell

## Notes

- The script automatically detects the latest timestamp based on filename sorting
- Timestamps are expected in format: `YYYYMMDD-HHMMSS`
- If a custom timestamp is provided that doesn't exist, a warning is shown but the tool still runs


