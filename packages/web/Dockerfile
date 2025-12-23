FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml ./
COPY packages/web/package.json ./packages/web/

# Enable pnpm and install dependencies
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/pnpm-lock.yaml ./

# Copy workspace files
COPY package.json ./
COPY packages ./packages
COPY tsconfig*.json ./
COPY pnpm-workspace.yaml ./

# Build workspace packages (required dependencies)
RUN corepack enable pnpm && pnpm build --filter @quantbot/core --filter @quantbot/utils --filter @quantbot/storage --filter @quantbot/analytics --filter @quantbot/simulation

# Build web package
RUN corepack enable pnpm && pnpm --filter @quantbot/web build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone build
COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/web/server.js"]

