FROM mcr.microsoft.com/devcontainers/javascript-node:20

RUN apt-get update && apt-get install -y --no-install-recommends \
  iptables ipset iproute2 dnsutils aggregate jq \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

COPY init-firewall.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/firewall && \
  chmod 0440 /etc/sudoers.d/firewall
