#!/usr/bin/env bash
set -euo pipefail

# Backup all Docker containers, images, and volumes to /home
# Run with: sudo ./scripts/system/backup-docker-to-home.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="/home/memez/docker-backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Docker Backup to /home Script ===${NC}"
echo ""

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

if ! docker info &>/dev/null; then
    echo -e "${RED}Error: Docker daemon is not running or you don't have permission${NC}"
    echo "Try running with: sudo $0"
    exit 1
fi

# Check available space on /home
HOME_AVAILABLE=$(df -BG /home | tail -1 | awk '{print $4}' | sed 's/G//')
echo "Available space on /home: ${HOME_AVAILABLE}GB"
echo ""

# Create backup directory
mkdir -p "$BACKUP_PATH"
mkdir -p "${BACKUP_PATH}/images"
mkdir -p "${BACKUP_PATH}/containers"
mkdir -p "${BACKUP_PATH}/volumes"
mkdir -p "${BACKUP_PATH}/configs"

echo -e "${YELLOW}Backup directory: $BACKUP_PATH${NC}"
echo ""

# 1. Backup all Docker images
echo -e "${YELLOW}[1/4] Backing up Docker images...${NC}"
IMAGE_COUNT=$(docker images --format "{{.Repository}}:{{.Tag}}" | wc -l)
echo "  Found $IMAGE_COUNT images"

if [[ $IMAGE_COUNT -gt 0 ]]; then
    IMAGE_LIST="${BACKUP_PATH}/images/image-list.txt"
    docker images --format "{{.Repository}}:{{.Tag}}" > "$IMAGE_LIST"
    
    echo "  Exporting images..."
    while IFS= read -r image; do
        if [[ -n "$image" ]] && [[ "$image" != "<none>:<none>" ]]; then
            # Create safe filename from image name
            SAFE_NAME=$(echo "$image" | sed 's/[\/:]/-/g')
            IMAGE_FILE="${BACKUP_PATH}/images/${SAFE_NAME}.tar"
            echo "    Exporting: $image"
            docker save "$image" -o "$IMAGE_FILE" 2>&1 | grep -v "sha256:" || true
        fi
    done < "$IMAGE_LIST"
    
    echo -e "  ${GREEN}✓ Images backed up to ${BACKUP_PATH}/images/${NC}"
else
    echo "  No images to backup"
fi
echo ""

# 2. Backup all containers (export running state)
echo -e "${YELLOW}[2/4] Backing up Docker containers...${NC}"
CONTAINER_COUNT=$(docker ps -a --format "{{.Names}}" | wc -l)
echo "  Found $CONTAINER_COUNT containers"

if [[ $CONTAINER_COUNT -gt 0 ]]; then
    CONTAINER_LIST="${BACKUP_PATH}/containers/container-list.txt"
    docker ps -a --format "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.ID}}" > "$CONTAINER_LIST"
    
    echo "  Exporting containers..."
    while IFS=$'\t' read -r name image status id; do
        if [[ -n "$name" ]]; then
            CONTAINER_FILE="${BACKUP_PATH}/containers/${name}.tar"
            echo "    Exporting: $name ($status)"
            
            # Export container filesystem
            docker export "$id" -o "$CONTAINER_FILE" 2>&1 | grep -v "sha256:" || {
                echo "      Warning: Could not export $name (may be running)"
            }
        fi
    done < "$CONTAINER_LIST"
    
    echo -e "  ${GREEN}✓ Containers backed up to ${BACKUP_PATH}/containers/${NC}"
else
    echo "  No containers to backup"
fi
echo ""

# 3. Backup all volumes
echo -e "${YELLOW}[3/4] Backing up Docker volumes...${NC}"
VOLUME_COUNT=$(docker volume ls --format "{{.Name}}" | wc -l)
echo "  Found $VOLUME_COUNT volumes"

if [[ $VOLUME_COUNT -gt 0 ]]; then
    VOLUME_LIST="${BACKUP_PATH}/volumes/volume-list.txt"
    docker volume ls --format "{{.Name}}" > "$VOLUME_LIST"
    
    echo "  Backing up volumes..."
    while IFS= read -r volume; do
        if [[ -n "$volume" ]]; then
            VOLUME_BACKUP="${BACKUP_PATH}/volumes/${volume}.tar"
            echo "    Backing up: $volume"
            
            # Create temporary container to backup volume
            TEMP_CONTAINER="backup-${volume}-${RANDOM}"
            docker run --rm \
                -v "$volume":/source:ro \
                -v "$(dirname "$VOLUME_BACKUP")":/backup \
                alpine tar czf "/backup/$(basename "$VOLUME_BACKUP")" -C /source . 2>&1 | grep -v "sha256:" || {
                echo "      Warning: Could not backup volume $volume"
            }
        fi
    done < "$VOLUME_LIST"
    
    echo -e "  ${GREEN}✓ Volumes backed up to ${BACKUP_PATH}/volumes/${NC}"
else
    echo "  No volumes to backup"
fi
echo ""

# 4. Backup Docker configurations and metadata
echo -e "${YELLOW}[4/4] Backing up Docker configurations...${NC}"

# Save docker-compose files if they exist
if command -v docker-compose &> /dev/null || docker compose version &>/dev/null; then
    echo "  Saving docker-compose configurations..."
    find /home/memez -name "docker-compose.yml" -o -name "docker-compose.yaml" 2>/dev/null | while read -r compose_file; do
        RELATIVE_PATH=$(echo "$compose_file" | sed "s|^/home/memez/||")
        mkdir -p "${BACKUP_PATH}/configs/$(dirname "$RELATIVE_PATH")"
        cp "$compose_file" "${BACKUP_PATH}/configs/${RELATIVE_PATH}" 2>/dev/null || true
    done
fi

# Save container inspect data
echo "  Saving container metadata..."
docker ps -a --format "{{.Names}}" | while read -r name; do
    if [[ -n "$name" ]]; then
        docker inspect "$name" > "${BACKUP_PATH}/configs/${name}-inspect.json" 2>/dev/null || true
    fi
done

# Save network configurations
echo "  Saving network configurations..."
docker network ls --format "{{.Name}}" | while read -r network; do
    if [[ -n "$network" ]] && [[ "$network" != "NETWORK" ]]; then
        docker network inspect "$network" > "${BACKUP_PATH}/configs/network-${network}.json" 2>/dev/null || true
    fi
done

echo -e "  ${GREEN}✓ Configurations backed up to ${BACKUP_PATH}/configs/${NC}"
echo ""

# Create restore script
echo -e "${YELLOW}Creating restore script...${NC}"
cat > "${BACKUP_PATH}/restore.sh" <<'RESTORE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

# Restore Docker backup
# Run with: sudo ./restore.sh

BACKUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Docker Restore Script ==="
echo "Backup directory: $BACKUP_DIR"
echo ""

# Restore images
if [[ -d "${BACKUP_DIR}/images" ]]; then
    echo "Restoring images..."
    for img in "${BACKUP_DIR}"/images/*.tar; do
        if [[ -f "$img" ]]; then
            echo "  Loading: $(basename "$img")"
            docker load -i "$img"
        fi
    done
fi

# Restore volumes
if [[ -d "${BACKUP_DIR}/volumes" ]]; then
    echo "Restoring volumes..."
    for vol_tar in "${BACKUP_DIR}"/volumes/*.tar; do
        if [[ -f "$vol_tar" ]]; then
            VOLUME_NAME=$(basename "$vol_tar" .tar)
            echo "  Restoring volume: $VOLUME_NAME"
            
            # Create volume if it doesn't exist
            docker volume create "$VOLUME_NAME" 2>/dev/null || true
            
            # Restore volume data
            docker run --rm \
                -v "$VOLUME_NAME":/target \
                -v "$(dirname "$vol_tar")":/backup:ro \
                alpine sh -c "cd /target && tar xzf /backup/$(basename "$vol_tar")"
        fi
    done
fi

echo ""
echo "✓ Restore complete!"
echo "Note: Containers need to be recreated manually using the backed up configurations"
RESTORE_SCRIPT

chmod +x "${BACKUP_PATH}/restore.sh"
echo -e "  ${GREEN}✓ Restore script created: ${BACKUP_PATH}/restore.sh${NC}"
echo ""

# Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
echo "=== Backup Complete ==="
echo ""
echo -e "${GREEN}Backup location: $BACKUP_PATH${NC}"
echo -e "${GREEN}Backup size: $BACKUP_SIZE${NC}"
echo ""
echo "Summary:"
echo "  Images: $(find "${BACKUP_PATH}/images" -name "*.tar" 2>/dev/null | wc -l) files"
echo "  Containers: $(find "${BACKUP_PATH}/containers" -name "*.tar" 2>/dev/null | wc -l) files"
echo "  Volumes: $(find "${BACKUP_PATH}/volumes" -name "*.tar" 2>/dev/null | wc -l) files"
echo ""
echo "To restore, run:"
echo "  sudo ${BACKUP_PATH}/restore.sh"
echo ""
echo "Disk space after backup:"
df -h /home | tail -1

