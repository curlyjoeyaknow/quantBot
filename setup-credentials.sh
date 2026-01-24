#!/bin/bash
# Credential Setup Script for QuantBot
# This script helps you add missing credentials to your .env file

set -e

ENV_FILE=".env"
ENV_EXAMPLE="env.example"

echo "🔐 QuantBot Credential Setup"
echo "============================"
echo ""

# Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo "📝 Creating .env from template..."
    cp "$ENV_EXAMPLE" "$ENV_FILE"
fi

# Function to add or update env variable
add_env_var() {
    local key=$1
    local value=$2
    local comment=$3
    
    if grep -q "^${key}=" "$ENV_FILE"; then
        # Update existing variable
        if [ -n "$comment" ]; then
            sed -i "s|^${key}=.*|${key}=${value}  # ${comment}|" "$ENV_FILE"
        else
            sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
        fi
    else
        # Add new variable
        if [ -n "$comment" ]; then
            echo "${key}=${value}  # ${comment}" >> "$ENV_FILE"
        else
            echo "${key}=${value}" >> "$ENV_FILE"
        fi
    fi
}

echo "📋 Adding InfluxDB Configuration..."

# Add InfluxDB section if it doesn't exist
if ! grep -q "# ==== InfluxDB Configuration ====" "$ENV_FILE"; then
    echo "" >> "$ENV_FILE"
    echo "# ==== InfluxDB Configuration ====" >> "$ENV_FILE"
fi

# Add InfluxDB variables
add_env_var "INFLUX_URL" "http://localhost:8086" "InfluxDB server URL"
add_env_var "INFLUX_USERNAME" "admin" "Initial admin username (for first-time setup)"
add_env_var "INFLUX_PASSWORD" "admin123456" "Initial admin password (for first-time setup)"
add_env_var "INFLUX_ORG" "quantbot" "InfluxDB organization name"
add_env_var "INFLUX_BUCKET" "quantbot_metrics" "Default bucket name"
add_env_var "INFLUX_TOKEN" "" "Admin token (get from InfluxDB UI after setup)"
add_env_var "INFLUX_OBSERVABILITY_BUCKET" "observability_metrics" "Bucket for observability metrics"

echo "✅ InfluxDB configuration added!"
echo ""
echo "📝 Next Steps:"
echo "1. Start InfluxDB: docker-compose up -d influxdb"
echo "2. Visit http://localhost:8086"
echo "3. Complete initial setup with:"
echo "   - Username: admin"
echo "   - Password: admin123456"
echo "   - Organization: quantbot"
echo "   - Bucket: quantbot_metrics"
echo "4. Copy the admin token and update INFLUX_TOKEN in .env"
echo ""
echo "💡 Tip: You can also get the token via:"
echo "   docker-compose exec influxdb influx setup list"
echo ""

