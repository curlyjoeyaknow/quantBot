#!/bin/bash
# Script to create Windows Recovery USB from Linux
# WARNING: This will ERASE all data on the selected USB drive

set -e

echo "=== Windows Recovery USB Creator ==="
echo ""
echo "Step 1: Identifying USB drives..."
echo ""

# List all block devices
echo "Available block devices:"
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL | grep -E "NAME|disk"

echo ""
echo "Please identify your USB drive from the list above."
echo "It should be something like /dev/sdX (where X is a letter like a, b, c, etc.)"
echo ""
read -p "Enter the USB device path (e.g., /dev/sdb): " USB_DEVICE

if [ -z "$USB_DEVICE" ]; then
    echo "Error: No device specified"
    exit 1
fi

# Remove partition number if user included it (e.g., /dev/sdb1 -> /dev/sdb)
USB_DEVICE=$(echo "$USB_DEVICE" | sed 's/[0-9]*$//')

# Verify device exists
if [ ! -b "$USB_DEVICE" ]; then
    echo "Error: $USB_DEVICE is not a valid block device"
    exit 1
fi

# Show device info
echo ""
echo "Selected device: $USB_DEVICE"
lsblk "$USB_DEVICE"
echo ""
echo "WARNING: This will ERASE ALL DATA on $USB_DEVICE"
read -p "Type 'YES' to continue: " CONFIRM

if [ "$CONFIRM" != "YES" ]; then
    echo "Aborted."
    exit 0
fi

# Check if device is mounted
MOUNTED=$(mount | grep "$USB_DEVICE" || true)
if [ -n "$MOUNTED" ]; then
    echo "Unmounting partitions on $USB_DEVICE..."
    for partition in $(lsblk -ln -o NAME "$USB_DEVICE" | grep -v "^$(basename $USB_DEVICE)$"); do
        if mountpoint -q "/dev/$partition" 2>/dev/null; then
            sudo umount "/dev/$partition" || true
        fi
    done
fi

# Step 2: Download Windows ISO (if not already present)
echo ""
read -p "Enter path to Windows ISO file (or press Enter to download): " ISO_PATH

if [ -z "$ISO_PATH" ]; then
    echo ""
    echo "To download Windows ISO, you can:"
    echo "1. Use the official Media Creation Tool on a Windows PC"
    echo "2. Download from Microsoft's website"
    echo "3. Use a tool like 'wget' with a direct link"
    echo ""
    echo "For now, please provide the ISO path:"
    read -p "ISO file path: " ISO_PATH
fi

if [ ! -f "$ISO_PATH" ]; then
    echo "Error: ISO file not found: $ISO_PATH"
    exit 1
fi

# Step 3: Create bootable USB
echo ""
echo "Creating bootable USB..."
echo "This may take 10-30 minutes depending on USB speed..."

# Method 1: Using woeusb (recommended for Windows)
if command -v woeusb &> /dev/null; then
    echo "Using woeusb..."
    sudo woeusb --device "$ISO_PATH" "$USB_DEVICE"
# Method 2: Using dd (fallback, but may not work for UEFI boot)
elif command -v dd &> /dev/null; then
    echo "Using dd (WARNING: May not work for UEFI boot)..."
    echo "This will take a while..."
    sudo dd if="$ISO_PATH" of="$USB_DEVICE" bs=4M status=progress oflag=sync
else
    echo "Error: No suitable tool found (woeusb or dd)"
    exit 1
fi

echo ""
echo "=== SUCCESS ==="
echo "Windows Recovery USB created on $USB_DEVICE"
echo ""
echo "To boot from USB:"
echo "1. Insert USB into target computer"
echo "2. Boot and enter BIOS/UEFI (usually F2, F12, Del, or Esc)"
echo "3. Set USB as first boot device"
echo "4. Save and exit"
echo "5. Boot from USB"
