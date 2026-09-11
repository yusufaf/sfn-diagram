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

# Stage 2: production deps only, plus the PNG rasterizer
FROM node:22-slim AS deps
WORKDIR /app
# NODE_ENV=production is what keeps the `pnpm add` below from re-installing
# every devDependency (puppeteer included) into the layer stage 3 copies.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
COPY package.json pnpm-lock.yaml ./
COPY scripts/resolve-optional-peer-version.mjs ./scripts/
# @resvg/resvg-js is a devDependency + *optional* peer, so `--prod` skips it and
# `--format png` throws the missing-peer error at runtime - #153, which shipped
# broken for three releases. Install it explicitly, pinned to the version the
# lockfile resolves (the resolver needs `yaml`, a prod dep, so it runs second).
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
    && RESVG_VERSION="$(node scripts/resolve-optional-peer-version.mjs --package @resvg/resvg-js)" \
    && test -n "$RESVG_VERSION" \
    && pnpm add --ignore-scripts --save-prod "@resvg/resvg-js@$RESVG_VERSION" \
    && test -d node_modules/@resvg/resvg-js \
    && test ! -d node_modules/puppeteer

# Stage 3: runtime image. resvg is a native rasterizer - no browser needed, but
# it does need real font files on disk to render text at all (unlike Puppeteer,
# which bundled its own), so fonts-liberation stays: it is the first path
# src/exporters/pngFonts.ts probes on linux.
FROM node:22-slim
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-liberation \
        ca-certificates \
        dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
ENTRYPOINT ["dumb-init", "--", "node", "dist/bin.js"]
CMD ["--help"]
