#!/usr/bin/env bash
#
# Setup Catalog Sync Systemd Service
#
# This script sets up a systemd service and timer to automatically sync
# completed backtest runs to the catalog every 5 minutes.
#
# Usage:
#   sudo ./scripts/setup-catalog-sync-systemd.sh [options]
#
# Options:
#   --user <username>       User to run service as (default: current user)
#   --interval <minutes>    Sync interval in minutes (default: 5)
#   --uninstall             Remove the systemd service and timer
#   --help                  Show this help message

set -euo pipefail

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Error: This script must be run as root (use sudo)"
  exit 1
fi

# Default values
USER="${SUDO_USER:-$USER}"
INTERVAL=5
UNINSTALL=false

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --user)
      USER="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --help)
      grep '^#' "$0" | grep -v '#!/' | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Service and timer files
SERVICE_FILE="/etc/systemd/system/quantbot-catalog-sync.service"
TIMER_FILE="/etc/systemd/system/quantbot-catalog-sync.timer"

# Uninstall mode
if [ "$UNINSTALL" = true ]; then
  echo "Uninstalling quantbot-catalog-sync systemd service..."
  
  # Stop and disable timer
  systemctl stop quantbot-catalog-sync.timer 2>/dev/null || true
  systemctl disable quantbot-catalog-sync.timer 2>/dev/null || true
  
  # Stop and disable service
  systemctl stop quantbot-catalog-sync.service 2>/dev/null || true
  systemctl disable quantbot-catalog-sync.service 2>/dev/null || true
  
  # Remove files
  rm -f "$SERVICE_FILE"
  rm -f "$TIMER_FILE"
  
  # Reload systemd
  systemctl daemon-reload
  
  echo "✓ Service and timer removed"
  exit 0
fi

# Validate user exists
if ! id "$USER" &>/dev/null; then
  echo "Error: User '$USER' does not exist"
  exit 1
fi

# Create service file
echo "Creating systemd service file..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=QuantBot Catalog Sync
After=network.target

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$PROJECT_ROOT
ExecStart=$PROJECT_ROOT/node_modules/.bin/quantbot backtest catalog-sync --base-dir runs --duckdb data/backtest_catalog.duckdb --stats
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create timer file
echo "Creating systemd timer file..."
cat > "$TIMER_FILE" <<EOF
[Unit]
Description=QuantBot Catalog Sync Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=${INTERVAL}min

[Install]
WantedBy=timers.target
EOF

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable and start timer
echo "Enabling and starting timer..."
systemctl enable quantbot-catalog-sync.timer
systemctl start quantbot-catalog-sync.timer

echo ""
echo "✓ Systemd service and timer installed"
echo ""
echo "Configuration:"
echo "  User:        $USER"
echo "  Interval:    Every $INTERVAL minute(s)"
echo "  Project:     $PROJECT_ROOT"
echo ""
echo "To check status:"
echo "  systemctl status quantbot-catalog-sync.timer"
echo "  systemctl status quantbot-catalog-sync.service"
echo ""
echo "To view logs:"
echo "  journalctl -u quantbot-catalog-sync.service -f"
echo ""
echo "To uninstall:"
echo "  sudo $0 --uninstall"

