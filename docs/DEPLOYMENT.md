# QuantBot Deployment Guide

> Production deployment guide for QuantBot analytics and simulation engine

## Overview

QuantBot is designed for deployment in various environments:

- **Development**: Local development with Docker Compose
- **Production**: Kubernetes, Docker, or bare metal
- **CI/CD**: Automated testing and deployment pipelines

---

## Prerequisites

### Required Services

- **Node.js** 18+ and pnpm
- **Docker** and Docker Compose (for databases)
- **ClickHouse** (time-series database)
- **DuckDB** (analytics database - file-based, no server needed)

### Optional Services

- **PostgreSQL** (legacy, being phased out)
- **Prometheus** (metrics collection)
- **Grafana** (metrics visualization)

### Environment Variables

See [env.example](../env.example) for complete list. Key variables:

```env
# DuckDB (Primary Database)
DUCKDB_PATH=./data/quantbot.duckdb

# ClickHouse (Time-Series Database)
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=quantbot

# Birdeye API (Multiple keys for rate limit handling)
BIRDEYE_API_KEY=your_primary_key
BIRDEYE_API_KEY_1=your_first_key
BIRDEYE_API_KEY_2=your_second_key

# Helius API
HELIUS_API_KEY=your_helius_key

# Logging
LOG_LEVEL=info
LOG_CONSOLE=true
LOG_FILE=true
LOG_DIR=./logs

# Application
NODE_ENV=production
PORT=3000
```

---

## Development Deployment

### Local Setup

```bash
# Clone repository
git clone <repository-url>
cd quantBot

# Install dependencies
pnpm install

# Build all packages (in correct dependency order)
pnpm build:ordered

# Copy environment template
cp env.example .env

# Edit .env with your API keys
nano .env

# Start databases (ClickHouse)
docker-compose up -d clickhouse

# Initialize ClickHouse schema
pnpm clickhouse:setup

# Start API server (optional)
pnpm --filter @quantbot/api start

# Run CLI commands
pnpm quantbot ingestion telegram --file data/raw/messages.html --caller-name Brook
pnpm quantbot ingestion ohlcv --from 2024-01-01 --to 2024-02-01
pnpm quantbot simulation run --strategy MyStrategy --from 2024-01-01 --to 2024-02-01
```

### Docker Compose (Full Stack)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**docker-compose.yml** includes:
- ClickHouse (time-series database)
- QuantBot API (optional)
- Prometheus (metrics, optional)
- Grafana (visualization, optional)

---

## Production Deployment

### Docker Deployment

#### Build Docker Image

```bash
# Build production image
docker build -t quantbot:latest -f Dockerfile.prod .

# Or use multi-stage build
docker build -t quantbot:latest .
```

#### Run Container

```bash
docker run -d \
  --name quantbot \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  quantbot:latest
```

#### Docker Compose (Production)

```yaml
version: '3.8'
services:
  quantbot:
    image: quantbot:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    env_file:
      - .env
    depends_on:
      - clickhouse
    restart: unless-stopped

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    ports:
      - "18123:8123"
      - "19000:9000"
    volumes:
      - clickhouse_data:/var/lib/clickhouse
    restart: unless-stopped

volumes:
  clickhouse_data:
```

---

### Kubernetes Deployment

#### Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: quantbot
```

#### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: quantbot-config
  namespace: quantbot
data:
  DUCKDB_PATH: "/data/quantbot.duckdb"
  CLICKHOUSE_HOST: "clickhouse"
  CLICKHOUSE_PORT: "18123"
  CLICKHOUSE_DATABASE: "quantbot"
  LOG_LEVEL: "info"
  NODE_ENV: "production"
```

#### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: quantbot-secrets
  namespace: quantbot
type: Opaque
stringData:
  BIRDEYE_API_KEY: "your_primary_key"
  BIRDEYE_API_KEY_1: "your_first_key"
  HELIUS_API_KEY: "your_helius_key"
```

#### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quantbot-api
  namespace: quantbot
spec:
  replicas: 2
  selector:
    matchLabels:
      app: quantbot-api
  template:
    metadata:
      labels:
        app: quantbot-api
    spec:
      containers:
      - name: quantbot-api
        image: quantbot:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: quantbot-config
        - secretRef:
            name: quantbot-secrets
        volumeMounts:
        - name: data
          mountPath: /data
        - name: logs
          mountPath: /logs
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: quantbot-data
      - name: logs
        emptyDir: {}
```

#### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: quantbot-api
  namespace: quantbot
spec:
  selector:
    app: quantbot-api
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

#### Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: quantbot-ingress
  namespace: quantbot
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
  - hosts:
    - api.quantbot.example.com
    secretName: quantbot-tls
  rules:
  - host: api.quantbot.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: quantbot-api
            port:
              number: 3000
```

---

## Database Setup

### ClickHouse

#### Initial Setup

```bash
# Start ClickHouse
docker-compose up -d clickhouse

# Initialize schema
pnpm clickhouse:setup

# Or manually
clickhouse-client --host localhost --port 19000 < migrations/clickhouse_schema.sql
```

#### Schema Migration

```bash
# Run migrations
pnpm clickhouse:migrate

# Or manually
clickhouse-client --host localhost --port 19000 < migrations/clickhouse_migration_001.sql
```

#### Backup

```bash
# Backup ClickHouse data
docker exec clickhouse clickhouse-client --query "BACKUP DATABASE quantbot TO Disk('backups', 'backup_$(date +%Y%m%d_%H%M%S)')"

# Restore
docker exec clickhouse clickhouse-client --query "RESTORE DATABASE quantbot FROM Disk('backups', 'backup_20250124_120000')"
```

### DuckDB

#### Initial Setup

DuckDB is file-based - no server setup needed. Files are created automatically.

```bash
# Default database location
data/quantbot.duckdb
data/result.duckdb
```

#### Backup

```bash
# Backup DuckDB file
cp data/quantbot.duckdb data/backup/quantbot_$(date +%Y%m%d_%H%M%S).duckdb

# Restore
cp data/backup/quantbot_20250124_120000.duckdb data/quantbot.duckdb
```

#### Migration

```bash
# Run migrations
pnpm duckdb:migrate

# Or manually (Python scripts)
python tools/storage/duckdb_migrate.py --db data/quantbot.duckdb --migration migrations/001_add_strategies.sql
```

---

## Monitoring & Observability

### Health Checks

**Health Endpoint**: `GET /health`

```bash
curl http://localhost:3000/health
```

**Readiness Probe**: `GET /health/ready`

```bash
curl http://localhost:3000/health/ready
```

**Liveness Probe**: `GET /health/live`

```bash
curl http://localhost:3000/health/live
```

### Metrics

**Prometheus Metrics**: `GET /metrics`

```bash
curl http://localhost:3000/metrics
```

**Prometheus Scrape Config**:

```yaml
scrape_configs:
  - job_name: 'quantbot-api'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['quantbot-api:3000']
```

### Logging

**Log Levels**: `error`, `warn`, `info`, `debug`, `trace`

**Log Output**:
- Console (stdout/stderr)
- File (rotating logs in `logs/` directory)
- Structured JSON format (for log aggregation)

**Log Rotation**:
- Max file size: 20MB
- Max files: 14 days
- Compression: gzip

### Alerting

**Recommended Alerts**:

1. **Health Check Failures**: Alert if `/health` returns non-200
2. **High Error Rate**: Alert if error rate > 5% over 5 minutes
3. **Circuit Breaker Tripped**: Alert if circuit breaker opens
4. **Database Connection Failures**: Alert if ClickHouse/DuckDB unavailable
5. **High Memory Usage**: Alert if memory > 80% of limit
6. **High CPU Usage**: Alert if CPU > 80% for 5 minutes

---

## Security

### API Keys

**Never commit API keys to git**. Use:

- Environment variables (`.env` file, not committed)
- Kubernetes Secrets
- Secret management services (AWS Secrets Manager, HashiCorp Vault)

### Network Security

- **Internal Services**: Use private networks (Docker networks, Kubernetes services)
- **External Access**: Use ingress controllers with TLS
- **Rate Limiting**: Implement rate limiting on API endpoints
- **Authentication**: Add API key authentication for production

### Data Security

- **Encryption at Rest**: Encrypt database volumes
- **Encryption in Transit**: Use TLS for all external connections
- **Access Control**: Limit database access to application only
- **Backup Encryption**: Encrypt backups before storage

---

## Scaling

### Horizontal Scaling

**API Server**:
- Stateless design allows horizontal scaling
- Use load balancer (Kubernetes Service, nginx, HAProxy)
- Share DuckDB files via network storage (NFS, EBS, etc.)

**Workers**:
- Background jobs can scale independently
- Use job queue (Redis, RabbitMQ) for distributed processing

### Vertical Scaling

**Resource Limits**:
- Memory: 2GB+ recommended for large simulations
- CPU: 2+ cores recommended for parallel processing
- Disk: 100GB+ for ClickHouse data

### Database Scaling

**ClickHouse**:
- Supports clustering for horizontal scaling
- Use replication for high availability
- Partition data by date for better performance

**DuckDB**:
- File-based, no clustering
- Use network storage (NFS, EBS) for shared access
- Consider ClickHouse for large-scale analytics

---

## Backup & Recovery

### Backup Strategy

1. **DuckDB**: Daily file backups
2. **ClickHouse**: Daily database backups
3. **Configuration**: Version control (git)
4. **Logs**: Rotating logs (14 days retention)

### Backup Script

```bash
#!/bin/bash
# scripts/backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups/$DATE"

mkdir -p "$BACKUP_DIR"

# Backup DuckDB
cp data/quantbot.duckdb "$BACKUP_DIR/quantbot.duckdb"
cp data/result.duckdb "$BACKUP_DIR/result.duckdb"

# Backup ClickHouse
docker exec clickhouse clickhouse-client --query "BACKUP DATABASE quantbot TO Disk('backups', 'backup_$DATE')"

# Backup configuration
cp .env "$BACKUP_DIR/.env"

echo "Backup completed: $BACKUP_DIR"
```

### Recovery

```bash
# Restore DuckDB
cp backups/20250124_120000/quantbot.duckdb data/quantbot.duckdb

# Restore ClickHouse
docker exec clickhouse clickhouse-client --query "RESTORE DATABASE quantbot FROM Disk('backups', 'backup_20250124_120000')"
```

---

## Troubleshooting

### Common Issues

**1. ClickHouse Connection Failed**

```bash
# Check ClickHouse is running
docker ps | grep clickhouse

# Check ClickHouse logs
docker logs clickhouse

# Test connection
clickhouse-client --host localhost --port 19000
```

**2. DuckDB File Locked**

```bash
# Check for hanging processes
lsof data/quantbot.duckdb

# Kill hanging processes
kill -9 <PID>
```

**3. API Server Won't Start**

```bash
# Check port is available
lsof -i :3000

# Check environment variables
env | grep QUANTBOT

# Check logs
tail -f logs/combined.log
```

**4. High Memory Usage**

```bash
# Check memory usage
docker stats quantbot

# Reduce batch sizes in workflows
# Use streaming for large datasets
```

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug pnpm --filter @quantbot/api start

# Enable trace logging
LOG_LEVEL=trace pnpm --filter @quantbot/api start
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: pnpm install
      - run: pnpm build:ordered
      - run: pnpm test
      - name: Deploy to production
        run: |
          # Deployment steps
```

### Docker Build

```bash
# Build and push to registry
docker build -t registry.example.com/quantbot:latest .
docker push registry.example.com/quantbot:latest

# Deploy to Kubernetes
kubectl set image deployment/quantbot-api quantbot-api=registry.example.com/quantbot:latest
```

---

## Related Documentation

- [ARCHITECTURE.md](./architecture/ARCHITECTURE.md) - System architecture
- [API.md](./api/API.md) - API documentation
- [README.md](../README.md) - Project overview
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines

