#!/bin/bash
# Create Windows Recovery Environment (WinRE) USB
# USB Device: /dev/sda

set -e

USB_DEVICE="/dev/sda"
USB_PARTITION="/dev/sda1"

echo "=== Windows Recovery Environment (WinRE) USB Creator ==="
echo "USB Device: $USB_DEVICE"
echo ""
echo "Windows RE is typically accessed through:"
echo "1. Windows Installation Media (boots to recovery options)"
echo "2. Recovery partition on existing Windows installation"
echo "3. Dedicated WinRE image"
echo ""

# Unmount USB if mounted
if mountpoint -q /media/memez/402B-8422 2>/dev/null; then
    echo "Unmounting USB..."
    umount "$USB_PARTITION" 2>/dev/null || sudo umount "$USB_PARTITION"
fi

echo ""
echo "OPTION 1: Use Windows Installation Media (Recommended)"
echo "  Windows Installation USB includes WinRE - boot from it and select 'Repair your computer'"
echo ""
echo "OPTION 2: Extract WinRE from existing Windows installation"
echo "  Requires access to a Windows PC with WinRE partition"
echo ""
echo "OPTION 3: Download Windows Installation Media (includes WinRE)"
echo ""

read -p "Do you have a Windows ISO/USB already? (yes/no): " HAS_ISO

if [ "$HAS_ISO" != "yes" ]; then
    echo ""
    echo "To get Windows Installation Media (which includes WinRE):"
    echo ""
    echo "METHOD 1: Download on Windows PC"
    echo "  1. Visit: https://www.microsoft.com/software-download/windows11"
    echo "  2. Download 'Media Creation Tool'"
    echo "  3. Run it and create ISO file"
    echo "  4. Transfer ISO to this Linux machine"
    echo ""
    echo "METHOD 2: Direct ISO Download (if available)"
    echo "  Microsoft provides direct links, but they change frequently"
    echo "  You may need to use the Media Creation Tool"
    echo ""
    echo "Once you have the Windows ISO, we can create the bootable USB."
    echo ""
    read -p "Enter path to Windows ISO (or press Enter to exit): " ISO_PATH
    
    if [ -z "$ISO_PATH" ]; then
        echo "Exiting. Get the Windows ISO first, then run this script again."
        exit 0
    fi
else
    read -p "Enter path to Windows ISO: " ISO_PATH
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

# Unmount all partitions
echo "Unmounting all partitions on $USB_DEVICE..."
for partition in $(lsblk -ln -o NAME "$USB_DEVICE" | grep -v "^$(basename $USB_DEVICE)$"); do
    if mountpoint -q "/dev/$partition" 2>/dev/null; then
        sudo umount "/dev/$partition" 2>/dev/null || true
    fi
done

# Wipe USB
echo "Preparing USB drive..."
sudo wipefs -a "$USB_DEVICE" 2>/dev/null || true

# Create bootable USB
echo ""
echo "Creating Windows Recovery USB (includes WinRE)..."
echo "This will take 10-30 minutes..."
echo ""

if command -v woeusb &> /dev/null; then
    sudo woeusb --device "$ISO_PATH" "$USB_DEVICE"
else
    echo "Error: woeusb not found"
    exit 1
fi

echo ""
echo "=== SUCCESS ==="
echo "Windows Recovery USB created!"
echo ""
echo "To access WinRE:"
echo "1. Boot from this USB"
echo "2. On the Windows Setup screen, click 'Repair your computer' (bottom left)"
echo "3. Or press Shift+F10 to open Command Prompt"
echo "4. This gives you access to:"
echo "   - BitLocker recovery"
echo "   - System Restore"
echo "   - Command Prompt"
echo "   - Startup Repair"
echo "   - System Image Recovery"
