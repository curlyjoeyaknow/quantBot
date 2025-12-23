# Web Dashboard Deployment Guide

## Production Deployment

The web dashboard is configured for production deployment using Next.js standalone output.

### Build Configuration

The `next.config.js` is configured with:
- `output: 'standalone'` - Creates a minimal production build
- Transpiles workspace packages for compatibility
- Server actions with 2MB body size limit

### Build Steps

```bash
# Install dependencies
pnpm install

# Build the web package
cd packages/web
pnpm build

# The standalone build will be in .next/standalone/
```

### Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable pnpm && pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/web/server.js"]
```

### Environment Variables

Required environment variables:

```bash
# Database connections
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_DATABASE=quantbot
DUCKDB_PATH=/data/quantbot.db

# API configuration
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Health Check

The dashboard includes a health check endpoint at `/api/health` that can be used for:
- Kubernetes liveness/readiness probes
- Load balancer health checks
- Monitoring systems

### Monitoring Integration

The dashboard can be integrated with:
- Prometheus metrics (via `/api/metrics` if implemented)
- Health check endpoint for uptime monitoring
- Error tracking (Sentry, etc.)

### Performance Optimization

- Static generation for analytics pages where possible
- API route caching for frequently accessed data
- Client-side data fetching with React Query (if implemented)

