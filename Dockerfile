# syntax=docker/dockerfile:1
# Firetop on Fly.io (M6): one machine, one volume, Litestream backups. Pattern from songbird.

# --- Build: install, build the client, bundle the server (engine + Fastify inlined) ---
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Manifests first, so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci
COPY . .
RUN npm run build -w @firetop/client && npm run build -w @firetop/server

# --- Runtime: the server bundle, the built client and Litestream. No node_modules. ---
FROM node:24-bookworm-slim
# The git commit, passed in by the deploy workflow (.git isn't copied into the image).
ARG FIRETOP_VERSION=dev
ENV NODE_ENV=production \
    FIRETOP_VERSION=$FIRETOP_VERSION \
    PORT=3000 \
    HOST=0.0.0.0 \
    FIRETOP_DB=/data/firetop.db \
    FIRETOP_CLIENT_DIR=/app/client
WORKDIR /app
COPY --from=build /app/packages/server/dist/ ./
COPY --from=build /app/packages/client/dist/ ./client/

# Litestream streams the database to the backup bucket (litestream.yml, start.sh).
ARG LITESTREAM_VERSION=0.5.17
ADD --checksum=sha256:cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d \
    https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz \
    /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream && rm /tmp/litestream.tar.gz
COPY litestream.yml /etc/litestream.yml
COPY --chmod=755 start.sh ./

VOLUME /data
EXPOSE 3000
CMD ["./start.sh"]
