# FVF Viewer production image.
# Build context: repository root (docker build -f deploy/Dockerfile .).
#
# Topological build order:
#   1. wasm-builder  — wasm-pack compiles crates/fvf-wasm -> crates/fvf-wasm/pkg
#   2. site-builder  — pnpm installs, server tsc + Vite build (imports the Wasm pkg)
#   3. runtime       — minimal Node image serving the SPA via apps/server

# --- Stage 1: Wasm package -------------------------------------------------
FROM rust:1.98-slim-bookworm AS wasm-builder

# slim images omit curl; the wasm-pack installer needs a downloader.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown \
    && curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh \
    && wasm-pack --version | grep -q 'wasm-pack 0.13.1'

WORKDIR /build

# Dependency layer first so registry downloads cache independently of source.
# A placeholder lib.rs lets cargo parse the workspace manifest before the real
# sources arrive; the COPY below overwrites it.
COPY Cargo.toml Cargo.lock ./
COPY crates/fvf-wasm/Cargo.toml crates/fvf-wasm/Cargo.toml
RUN mkdir -p crates/fvf-wasm/src && touch crates/fvf-wasm/src/lib.rs \
    && cargo fetch --locked

COPY crates/fvf-wasm crates/fvf-wasm
RUN wasm-pack build crates/fvf-wasm --target web

# --- Stage 2: server + site ------------------------------------------------
FROM node:22-bookworm-slim AS site-builder

ENV CI=1
RUN corepack enable
WORKDIR /app

# Workspace manifests only: this layer caches `pnpm install` across source edits.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .nvmrc tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY crates/fvf-wasm/package.json crates/fvf-wasm/package.json
RUN pnpm install --frozen-lockfile

# The compiled Wasm package must exist before Vite compiles the SPA.
COPY --from=wasm-builder /build/crates/fvf-wasm/pkg crates/fvf-wasm/pkg

COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @fvf/server build \
    && pnpm --filter @fvf/web build \
    && pnpm install --frozen-lockfile --prod --filter @fvf/server

# --- Stage 3: runtime ------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

# Repository-relative layout keeps the server's defaults valid:
#   apps/server/dist/start.js reads ../package.json and ../../web/dist.
COPY --from=site-builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=site-builder /app/node_modules node_modules
COPY --from=site-builder /app/apps/server/package.json apps/server/package.json
COPY --from=site-builder /app/apps/server/node_modules apps/server/node_modules
COPY --from=site-builder /app/apps/server/dist apps/server/dist
COPY --from=site-builder /app/apps/web/dist apps/web/dist

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server"]
