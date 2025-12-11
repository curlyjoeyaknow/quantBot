#!/bin/bash
# Deployment script for QuantBot to AWS EC2 instance

set -e

# Configuration - Update these with your AWS instance details
AWS_HOST="${AWS_HOST:-}"
AWS_USER="${AWS_USER:-ubuntu}"
AWS_KEY="${AWS_KEY:-~/.ssh/aws-key.pem}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/quantBot}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 QuantBot AWS Deployment Script${NC}"
echo ""

# Check if AWS_HOST is set
if [ -z "$AWS_HOST" ]; then
    echo -e "${RED}❌ Error: AWS_HOST environment variable is not set${NC}"
    echo "Usage: AWS_HOST=your-ec2-instance.com ./deploy-to-aws.sh"
    echo "Or set in your environment: export AWS_HOST=your-ec2-instance.com"
    exit 1
fi

echo -e "${YELLOW}📋 Deployment Configuration:${NC}"
echo "  Host: $AWS_HOST"
echo "  User: $AWS_USER"
echo "  Key: $AWS_KEY"
echo "  Remote Directory: $REMOTE_DIR"
echo ""

# Test SSH connection
echo -e "${YELLOW}🔌 Testing SSH connection...${NC}"
if ssh -i "$AWS_KEY" -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$AWS_USER@$AWS_HOST" "echo 'Connection successful'" 2>/dev/null; then
    echo -e "${GREEN}✅ SSH connection successful${NC}"
else
    echo -e "${RED}❌ SSH connection failed${NC}"
    echo "Please check:"
    echo "  1. AWS_HOST is correct"
    echo "  2. SSH key is at $AWS_KEY"
    echo "  3. Security group allows SSH (port 22)"
    exit 1
fi

# Pull latest changes on remote
echo -e "${YELLOW}📥 Pulling latest changes on remote...${NC}"
ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "cd $REMOTE_DIR && git pull origin refactor/complete-command-handler-extraction || git pull origin main"

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "cd $REMOTE_DIR && pnpm install"

# Build packages
echo -e "${YELLOW}🔨 Building packages...${NC}"
ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "cd $REMOTE_DIR && pnpm run build:packages || npm run build:packages"

# Stop existing bot process (if running)
echo -e "${YELLOW}🛑 Stopping existing bot process...${NC}"
ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "cd $REMOTE_DIR && pkill -f 'packages/bot/src/main.ts' || pkill -f 'npm start' || true"

# Start the bot
echo -e "${YELLOW}🚀 Starting Telegram bot...${NC}"
ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "cd $REMOTE_DIR && nohup npm start > bot.log 2>&1 &"

# Wait a moment and check if bot started
sleep 3
if ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "pgrep -f 'packages/bot/src/main.ts' || pgrep -f 'npm start'" > /dev/null; then
    echo -e "${GREEN}✅ Bot started successfully${NC}"
    echo ""
    echo -e "${GREEN}📊 Bot Status:${NC}"
    ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "cd $REMOTE_DIR && tail -20 bot.log"
else
    echo -e "${RED}❌ Bot may not have started. Check logs:${NC}"
    ssh -i "$AWS_KEY" "$AWS_USER@$AWS_HOST" "cd $REMOTE_DIR && tail -50 bot.log"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo "To view logs: ssh -i $AWS_KEY $AWS_USER@$AWS_HOST 'cd $REMOTE_DIR && tail -f bot.log'"

