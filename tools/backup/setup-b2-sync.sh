#!/usr/bin/env bash
set -euo pipefail

# Setup script for B2 backup systemd service and timer

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="b2-sync-opn"
SERVICE_FILE="${SCRIPT_DIR}/${SERVICE_NAME}.service"
TIMER_FILE="${SCRIPT_DIR}/${SERVICE_NAME}.timer"
SYSTEMD_DIR="/etc/systemd/system"

echo "========================================="
echo "B2 Backup Setup Script"
echo "========================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)" 
   exit 1
fi

# Check if b2 CLI is installed
B2_CLI="/home/memez/.local/bin/b2"
if [[ ! -x "${B2_CLI}" ]]; then
  echo "ERROR: b2 CLI not found at ${B2_CLI}"
  echo "Install with: pipx install b2"
  echo "Or: pip install --user b2"
  exit 1
fi

echo "Found B2 CLI at: ${B2_CLI}"

# Check if service files exist
if [[ ! -f "${SERVICE_FILE}" ]]; then
  echo "ERROR: Service file not found: ${SERVICE_FILE}"
  exit 1
fi

if [[ ! -f "${TIMER_FILE}" ]]; then
  echo "ERROR: Timer file not found: ${TIMER_FILE}"
  exit 1
fi

# Make backup script executable
echo "Making backup script executable..."
chmod +x "${SCRIPT_DIR}/b2-sync-opn.sh"

# Copy service and timer files to systemd directory
echo "Installing systemd service and timer..."
cp "${SERVICE_FILE}" "${SYSTEMD_DIR}/"
cp "${TIMER_FILE}" "${SYSTEMD_DIR}/"

# Reload systemd daemon
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable and start timer
echo "Enabling and starting timer..."
systemctl enable "${SERVICE_NAME}.timer"
systemctl start "${SERVICE_NAME}.timer"

# Show status
echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "Timer status:"
systemctl status "${SERVICE_NAME}.timer" --no-pager
echo ""
echo "Next scheduled runs:"
systemctl list-timers "${SERVICE_NAME}.timer" --no-pager
echo ""
echo "Useful commands:"
echo "  - Check timer status:  systemctl status ${SERVICE_NAME}.timer"
echo "  - Check service logs:  journalctl -u ${SERVICE_NAME}.service -f"
echo "  - Run backup now:      systemctl start ${SERVICE_NAME}.service"
echo "  - Stop timer:          systemctl stop ${SERVICE_NAME}.timer"
echo "  - Disable timer:       systemctl disable ${SERVICE_NAME}.timer"
echo ""
echo "NOTE: Make sure B2 is authorized by running:"
echo "  ${B2_CLI} account authorize"
