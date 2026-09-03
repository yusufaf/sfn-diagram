# syntax=docker/dockerfile:1.7

# Stage 1: build the package (dist/)
FROM node:22-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsdown.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm run build

# Stage 2: production deps only (no dev deps, no Chromium download)
FROM node:22-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Stage 3: runtime image with system Chromium
FROM node:22-slim
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        ca-certificates \
        dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
ENTRYPOINT ["dumb-init", "--", "node", "dist/cli.js"]
CMD ["--help"]
