# The Obsidian check (scripts/obsidian-check.mjs): Obsidian in a virtual
# display, driven by WebdriverIO through wdio-obsidian-service. The image holds
# no Obsidian build: the service downloads one at run time into a volume,
# because Obsidian's terms do not allow redistributing it.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
LABEL org.mdrefine.base-image="node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c"

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates xvfb xauth \
      libasound2 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
      libnotify4 libnss3 libpango-1.0-0 libsecret-1-0 libx11-xcb1 \
      libxcomposite1 libxdamage1 libxkbcommon0 libxrandr2 libxshmfence1 \
      libxss1 libxtst6 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /check/.obsidian-cache /out \
 && chown -R node:node /check /out

USER node
WORKDIR /check
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node provided-binaries ./provided-binaries
COPY --chown=node:node verify-dependencies.mjs service.mjs ./
RUN npm ci --no-audit --no-fund
RUN node verify-dependencies.mjs
COPY --chown=node:node run.sh wdio.conf.mjs obsidian.e2e.mjs baseline.json ./
COPY --chown=node:node vault ./vault
ENTRYPOINT ["sh", "/check/run.sh"]
