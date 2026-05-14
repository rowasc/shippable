FROM mcr.microsoft.com/devcontainers/javascript-node:22

RUN apt-get update && apt-get install -y --no-install-recommends \
  iptables ipset iproute2 dnsutils jq unzip \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Bun — required to compile the desktop sidecar (`bun build --compile`) and to
# verify the cross-runtime SQLite adapter (`bun:sqlite`). Installed at build
# time, before the runtime firewall locks down egress.
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

# Playwright's Chromium for the web/ e2e suite. The runtime firewall blocks
# the browser-download CDN, so it has to be installed at build time. Pinned to
# the project's playwright version; `--with-deps` pulls the OS libraries
# Chromium needs. `PLAYWRIGHT_BROWSERS_PATH` is a shared, world-readable
# location so the `node` user finds the browser the root build step installed;
# `PLAYWRIGHT_CHANNEL=chromium` makes playwright.config.ts use this bundled
# build instead of looking for a system Google Chrome.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_CHANNEL=chromium
RUN npx -y playwright@1.60.0 install --with-deps chromium \
  && chmod -R a+rX /ms-playwright \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

# Install under a unique name — the Claude Code Feature bundles its own
# /usr/local/bin/init-firewall.sh and would clobber ours otherwise.
COPY init-firewall.sh /usr/local/bin/sandbox-firewall.sh
RUN chmod +x /usr/local/bin/sandbox-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/sandbox-firewall.sh" > /etc/sudoers.d/firewall && \
  chmod 0440 /etc/sudoers.d/firewall
