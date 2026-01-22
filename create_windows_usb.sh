#!/bin/bash
# Create Windows Recovery USB
# USB Device: /dev/sda (28.7GB Cruzer Blade)

set -e

USB_DEVICE="/dev/sda"
USB_PARTITION="/dev/sda1"

echo "=== Windows Recovery USB Creator ==="
echo "USB Device: $USB_DEVICE (28.7GB)"
echo ""

# Unmount USB if mounted
if mountpoint -q /media/memez/402B-8422 2>/dev/null; then
    echo "Unmounting USB..."
    umount "$USB_PARTITION" 2>/dev/null || sudo umount "$USB_PARTITION"
fi

# Check for Windows ISO
echo "Looking for Windows ISO file..."
ISO_FILES=$(find ~/Downloads ~/Desktop ~ -maxdepth 3 -name "*indows*.iso" -o -name "Win*.iso" 2>/dev/null | head -5)

if [ -z "$ISO_FILES" ]; then
    echo ""
    echo "No Windows ISO found. You need to download one first."
    echo ""
    echo "Options:"
    echo "1. Download from Microsoft: https://www.microsoft.com/software-download/windows11"
    echo "2. Use Media Creation Tool on a Windows PC"
    echo "3. If you have the ISO elsewhere, specify the path"
    echo ""
    read -p "Enter path to Windows ISO (or 'download' to get instructions): " ISO_PATH
    
    if [ "$ISO_PATH" = "download" ] || [ -z "$ISO_PATH" ]; then
        echo ""
        echo "To download Windows 11 ISO directly:"
        echo "1. Visit: https://www.microsoft.com/software-download/windows11"
        echo "2. Click 'Download Now' under 'Create Windows 11 Installation Media'"
        echo "3. Or use this PowerShell command on Windows:"
        echo "   Invoke-WebRequest -Uri 'https://software.download.prss.microsoft.com/dbazure/Win11_24H2_English_x64.iso' -OutFile 'Windows11.iso'"
        echo ""
        echo "Once downloaded, save it and run this script again with the ISO path."
        exit 0
    fi
else
    echo "Found potential Windows ISO files:"
    echo "$ISO_FILES"
    echo ""
    read -p "Enter the full path to your Windows ISO: " ISO_PATH
fi

if [ ! -f "$ISO_PATH" ]; then
    echo "Error: ISO file not found: $ISO_PATH"
    exit 1
fi

echo ""
echo "WARNING: This will ERASE ALL DATA on $USB_DEVICE"
read -p "Type 'YES' to continue: " CONFIRM

if [ "$CONFIRM" != "YES" ]; then
    echo "Aborted."
    exit 0
fi

# Unmount all partitions on the USB
echo "Unmounting all partitions on $USB_DEVICE..."
for partition in $(lsblk -ln -o NAME "$USB_DEVICE" | grep -v "^$(basename $USB_DEVICE)$"); do
    if mountpoint -q "/dev/$partition" 2>/dev/null; then
        sudo umount "/dev/$partition" 2>/dev/null || true
    fi
done

# Wipe the USB drive
echo "Wiping USB drive..."
sudo wipefs -a "$USB_DEVICE" 2>/dev/null || true
sudo sgdisk --zap-all "$USB_DEVICE" 2>/dev/null || true

# Create bootable USB using woeusb
echo ""
echo "Creating bootable USB (this may take 10-30 minutes)..."
echo "Using woeusb to write $ISO_PATH to $USB_DEVICE"
echo ""

if command -v woeusb &> /dev/null; then
    sudo woeusb --device "$ISO_PATH" "$USB_DEVICE"
elif command -v woeusb-cli &> /dev/null; then
    sudo woeusb-cli --device "$ISO_PATH" "$USB_DEVICE"
else
    echo "Error: woeusb not found. Installing..."
    echo "You may need to install it first:"
    echo "  sudo apt install woeusb  # Ubuntu/Debian"
    echo "  sudo pacman -S woeusb     # Arch"
    exit 1
fi

echo ""
echo "=== SUCCESS ==="
echo "Windows Recovery USB created successfully!"
echo ""
echo "To use it:"
echo "1. Safely remove the USB"
echo "2. Insert it into the computer with BitLocker"
echo "3. Boot and enter BIOS/UEFI (usually F2, F12, Del, or Esc)"
echo "4. Set USB as first boot device"
echo "5. Save and exit"
echo "6. Boot from USB to access Windows Recovery Environment"
