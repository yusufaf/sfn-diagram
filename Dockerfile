# syntax=docker/dockerfile:1.7

# Stage 1: build the package (dist/)
#
# Pinned to the *build* platform rather than the target: `dist/` is plain JavaScript
# and byte-identical for every architecture, while the tooling that produces it
# (tsdown, i.e. rolldown) is a multi-threaded native Rust binary. Emulating that under
# QEMU for the arm64 leg costs minutes and is a known source of crashes - at release
# time, which is the only time the multi-platform build runs. The `deps` stage below
# stays target-arch, because @resvg/resvg-js does ship a per-architecture binary.
# It ships nothing into the image, so it stays on Debian.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CI=true
COPY package.json pnpm-lock.yaml ./
# Node 25+ images no longer ship corepack, so install the exact pnpm the
# repo pins in package.json#packageManager instead of activating it.
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsdown.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm run build

# Stage 2: production deps only, plus the PNG rasterizer
#
# Alpine, like the runtime: pnpm picks resvg's native binary by the libc it runs
# on, so on Alpine it installs the musl binary resvg loads there (pnpm 9 also
# installs the unused gnu one).
FROM node:24-alpine AS deps
WORKDIR /app
# NODE_ENV=production is what keeps the `pnpm add` below from re-installing
# every devDependency (puppeteer included) into the layer stage 3 copies.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production \
    CI=true
COPY package.json pnpm-lock.yaml ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
# Both files, not just the first: resolve-optional-peer-version.mjs imports the
# shared argv/error scaffold from scripts/lib/ (#230), and a missing COPY here is
# exactly what broke every image from v1.4.0 to v1.5.0.
COPY scripts/resolve-optional-peer-version.mjs ./scripts/
COPY scripts/lib ./scripts/lib
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

# Stage 3: runtime image, on Alpine since 2.0 (#555). The Debian base carried 35 high
# and critical OS findings that Debian has not fixed, some it won't; the Alpine image had
# none. Distroless was the other candidate: it has no shell (for the smoke checks, for
# images built FROM this one, or a CI job image - #589), its base had fixable findings
# it cannot patch between Google's rebuilds, and the fonts and init would be copied in
# where no scanner sees them.
#
# resvg renders no text without a real font file on disk, so font-liberation stays;
# src/exporters/pngFonts.ts probes its Alpine path. It pulls in fontconfig and its
# libraries, which resvg never loads; they stay apk-tracked so scans and `apk upgrade`
# cover them.
FROM node:24-alpine
ENV NODE_ENV=production

# `upgrade`: the base's packages lag security fixes between base rebuilds (#554). The rm
# drops the npm, corepack and yarn that node:24-alpine bundles: the runtime never runs
# them, and npm's own node_modules carried every node-pkg finding the scans reported.
RUN apk upgrade --no-cache \
    && apk add --no-cache font-liberation dumb-init \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
ENTRYPOINT ["dumb-init", "--", "node", "dist/bin.js"]
CMD ["--help"]
