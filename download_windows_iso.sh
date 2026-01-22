#!/bin/bash
# Helper to download Windows ISO
# Note: Microsoft requires authentication for direct downloads

echo "=== Windows ISO Download Helper ==="
echo ""
echo "Microsoft doesn't provide direct ISO downloads without authentication."
echo "Here are your options:"
echo ""
echo "OPTION 1: Use Media Creation Tool (Recommended)"
echo "  1. On a Windows PC, download Media Creation Tool from:"
echo "     https://www.microsoft.com/software-download/windows11"
echo "  2. Run it and select 'Create installation media'"
echo "  3. Choose 'ISO file' instead of USB"
echo "  4. Save the ISO file"
echo ""
echo "OPTION 2: Download via wget (if you have a direct link)"
echo "  wget -O ~/Downloads/Windows11.iso 'YOUR_DIRECT_LINK_HERE'"
echo ""
echo "OPTION 3: Use rufus or similar tool on Windows to create bootable USB"
echo ""
echo "Once you have the ISO file, run:"
echo "  sudo ./create_windows_usb.sh"
