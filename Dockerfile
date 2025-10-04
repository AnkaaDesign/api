# Multi-stage build for NestJS API in pnpm monorepo
FROM node:18-alpine AS base

# Build arguments for version tracking
ARG GIT_COMMIT_SHA=unknown
ARG GIT_COMMIT_SHORT=unknown
ARG GIT_BRANCH=unknown
ARG BUILD_NUMBER=local
ARG BUILD_TIMESTAMP
ARG DEPLOYED_BY=docker
ARG DEPLOYMENT_METHOD=docker
ARG NODE_ENV=production

# Set as environment variables
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV GIT_COMMIT_SHORT=${GIT_COMMIT_SHORT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV BUILD_NUMBER=${BUILD_NUMBER}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV DEPLOYED_BY=${DEPLOYED_BY}
ENV DEPLOYMENT_METHOD=${DEPLOYMENT_METHOD}
ENV NODE_ENV=${NODE_ENV}

# Install pnpm and build dependencies
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev git \
    && npm install -g pnpm@10

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./

# Copy all package.json files for dependency resolution
COPY packages/constants/package.json ./packages/constants/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/services/package.json ./packages/services/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/hooks/package.json ./packages/hooks/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile --prod

# Build stage
FROM base AS build

# Re-declare build args for this stage
ARG GIT_COMMIT_SHA
ARG GIT_COMMIT_SHORT
ARG GIT_BRANCH
ARG BUILD_NUMBER
ARG BUILD_TIMESTAMP
ARG DEPLOYED_BY
ARG DEPLOYMENT_METHOD

# Set as environment variables for build scripts
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV GIT_COMMIT_SHORT=${GIT_COMMIT_SHORT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV BUILD_NUMBER=${BUILD_NUMBER}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV DEPLOYED_BY=${DEPLOYED_BY}
ENV DEPLOYMENT_METHOD=${DEPLOYMENT_METHOD}
ENV CI=true

# Install all dependencies (including dev)
RUN pnpm install --frozen-lockfile

# Copy workspace packages source
COPY packages ./packages

# Copy API source
COPY apps/api ./apps/api

# Generate Prisma Client
WORKDIR /app/apps/api
RUN npx prisma generate

# Build packages
WORKDIR /app
RUN pnpm run build:packages

# Build API (this will generate build-info.json)
WORKDIR /app/apps/api
RUN pnpm run build

# Verify build-info.json was created
RUN echo "Build info generated:" && \
    (cat src/build-info.json 2>/dev/null || cat dist/build-info.json 2>/dev/null || echo "Warning: build-info.json not found")

# Production stage
FROM node:18-alpine AS production

# Install dumb-init and runtime dependencies
RUN apk add --no-cache dumb-init cairo jpeg pango giflib

# Create app user
RUN addgroup -g 1001 -S nodejs && adduser -S nodeuser -u 1001

WORKDIR /app

# Copy built application and dependencies
COPY --from=build --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodeuser:nodejs /app/packages ./packages
COPY --from=build --chown=nodeuser:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=nodeuser:nodejs /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=nodeuser:nodejs /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=nodeuser:nodejs /app/apps/api/.env* ./apps/api/ 2>/dev/null || true

# Create uploads directory
RUN mkdir -p /app/apps/api/uploads && chown -R nodeuser:nodejs /app/apps/api/uploads

# Switch to non-root user
USER nodeuser

WORKDIR /app/apps/api

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3030/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Expose port
EXPOSE 3030

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/apps/api/src/main.js"]
