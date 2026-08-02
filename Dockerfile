# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base

WORKDIR /opt/vellym

FROM base AS development

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      openssh-client \
      python3 \
      sudo \
    && rm -rf /var/lib/apt/lists/* \
    && echo "node ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

USER node

FROM base AS builder

WORKDIR /src

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/vellym/package.json packages/vellym/package.json
COPY packages/runtime-node/package.json packages/runtime-node/package.json
COPY packages/ui-react/package.json packages/ui-react/package.json

RUN npm ci

COPY . .

RUN npm run build

FROM debian:bookworm-slim AS runtime

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /workspace \
    && chown 1000:1000 /workspace

COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/LICENSE /usr/local/LICENSE
COPY --from=builder --chown=1000:1000 /src/packages/vellym/dist /opt/vellym/dist
COPY --chown=1000:1000 packages/vellym/package.json /opt/vellym/package.json
COPY --chown=1000:1000 packages/vellym/README.md /opt/vellym/README.md

WORKDIR /workspace

USER 1000:1000

EXPOSE 4173

ENTRYPOINT ["node", "/opt/vellym/dist/cli.mjs"]
CMD ["dev", "--host", "0.0.0.0"]
