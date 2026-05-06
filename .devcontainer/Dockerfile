FROM mcr.microsoft.com/devcontainers/javascript-node:20

RUN apt-get update && apt-get install -y --no-install-recommends \
  iptables ipset iproute2 dnsutils \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

# Install under a unique name — the Claude Code Feature bundles its own
# /usr/local/bin/init-firewall.sh and would clobber ours otherwise.
COPY init-firewall.sh /usr/local/bin/sandbox-firewall.sh
RUN chmod +x /usr/local/bin/sandbox-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/sandbox-firewall.sh" > /etc/sudoers.d/firewall && \
  chmod 0440 /etc/sudoers.d/firewall
