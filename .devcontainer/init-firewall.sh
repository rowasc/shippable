#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true
ipset destroy github-https 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# First allow DNS and localhost before any restrictions
# Allow outbound DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
# Allow inbound DNS responses
iptables -A INPUT -p udp --sport 53 -j ACCEPT
# Allow localhost
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Create ipset with CIDR support
ipset create allowed-domains hash:net

# Required domains: the container is pointless without these. Hard-fail if
# resolution fails — the firewall init aborts and the container won't come up,
# which is the correct outcome (better to surface the problem than to silently
# bring up a broken sandbox).
for domain in \
    "api.anthropic.com"; do
    echo "Resolving $domain..."
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "ERROR: Failed to resolve $domain"
        exit 1
    fi

    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "ERROR: Invalid IP from DNS for $domain: $ip"
            exit 1
        fi
        echo "Adding $ip for $domain"
        ipset add allowed-domains "$ip"
    done < <(echo "$ips")
done

# Optional domains: useful but not strictly required for the container to
# function. Soft-fail — if resolution fails, log a warning and leave the
# host out of the allowlist. The sandbox still comes up; that one host is
# blocked for the session and the user can retry on the next container start.
for domain in \
    "registry.npmjs.org" \
    "marketplace.visualstudio.com" \
    "vscode.blob.core.windows.net" \
    "update.code.visualstudio.com"; do
    echo "Resolving $domain..."
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "WARNING: Failed to resolve $domain — fetches against $domain will be blocked this session."
        continue
    fi

    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "WARNING: Skipping invalid IP from DNS for $domain: $ip"
            continue
        fi
        echo "Adding $ip for $domain"
        ipset add allowed-domains "$ip" 2>/dev/null || true
    done < <(echo "$ips")
done

# GitHub: allow HTTPS only. SSH (port 22) is intentionally left blocked.
# Source IP ranges from https://api.github.com/meta where possible (stable
# published CIDRs) and fall back to DNS-at-boot for hosts the meta endpoint
# does not cover. Must run before the DROP policy is set further below.
#
# Failures here are non-fatal: a missing /meta or unresolvable DNS leaves the
# github-https ipset empty (or partially populated) and the matching iptables
# rule will simply not match anything — GitHub traffic falls through to the
# default REJECT. That's the right tradeoff: HTTPS to GitHub is optional in
# yolo mode, so we'd rather lose GitHub than refuse to bring up the sandbox.
ipset create github-https hash:net

echo "Fetching GitHub IP ranges from https://api.github.com/meta..."
GITHUB_META=$(curl -fsSL --connect-timeout 5 --max-time 15 https://api.github.com/meta || true)
if [ -z "$GITHUB_META" ]; then
    echo "WARNING: Failed to fetch /meta — GitHub HTTPS will be blocked this session."
else
    # .web (github.com), .api (api.github.com), .git (git protocol endpoints).
    # IPv4 only — the rules below are iptables, not ip6tables.
    GITHUB_CIDRS=$(echo "$GITHUB_META" \
        | jq -r '((.web // []) + (.api // []) + (.git // []))[] | select(contains(":") | not)' \
        || true)
    if [ -z "$GITHUB_CIDRS" ]; then
        echo "WARNING: /meta returned no IPv4 CIDRs — GitHub HTTPS will be blocked this session."
    else
        while read -r cidr; do
            if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
                echo "WARNING: Skipping invalid CIDR from /meta: $cidr"
                continue
            fi
            echo "Adding $cidr to github-https (from /meta)"
            ipset add github-https "$cidr" 2>/dev/null || true
        done < <(echo "$GITHUB_CIDRS")
    fi
fi

# CDN-fronted GitHub hosts are not published in /meta. Resolve via DNS at
# boot — IPs rotate, so this is best-effort and only valid for this session.
# Failures here are also non-fatal: just that host is blocked.
for domain in \
    "codeload.github.com" \
    "objects.githubusercontent.com" \
    "raw.githubusercontent.com"; do
    echo "Resolving $domain..."
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "WARNING: Failed to resolve $domain — fetches against $domain will be blocked."
        continue
    fi
    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "WARNING: Skipping invalid IP from DNS for $domain: $ip"
            continue
        fi
        echo "Adding $ip for $domain (CDN, via DNS)"
        ipset add github-https "$ip" 2>/dev/null || true
    done < <(echo "$ips")
done

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

# Set up remaining iptables rules
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Set default policies to DROP first
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# First allow established connections for already approved traffic
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Then allow only specific outbound traffic to allowed domains
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# GitHub HTTPS is permitted; port 22 (SSH) is not matched here so it falls through to REJECT.
iptables -A OUTPUT -p tcp --dport 443 -m set --match-set github-https dst -j ACCEPT

# Explicitly REJECT all other outbound traffic for immediate feedback
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

# Verify Anthropic API access
if ! curl --connect-timeout 5 https://api.anthropic.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.anthropic.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.anthropic.com as expected"
fi

# Verify GitHub HTTPS reachability — only assert if the github-https ipset
# was populated. An empty ipset is a deliberate state (see soft-fail above)
# and means "GitHub is intentionally blocked this session"; failing the
# verification in that case would defeat the soft-fail.
if [ "$(ipset list github-https | awk '/^Number of entries:/ {print $4}')" -gt 0 ]; then
    if ! curl --connect-timeout 5 -sSf https://github.com >/dev/null 2>&1; then
        echo "ERROR: Firewall verification failed - github-https is populated but https://github.com is unreachable"
        exit 1
    else
        echo "Firewall verification passed - able to reach https://github.com as expected"
    fi
else
    echo "Firewall verification skipped - github-https ipset is empty (GitHub blocked this session)"
fi

# Verify GitHub SSH (port 22) is blocked. This must always hold regardless
# of whether HTTPS is allowed, because it's the security contract of yolo mode.
if timeout 5 bash -c '</dev/tcp/github.com/22' 2>/dev/null; then
    echo "ERROR: Firewall verification failed - github.com:22 (SSH) is reachable but should be blocked"
    exit 1
else
    echo "Firewall verification passed - github.com:22 (SSH) is blocked as expected"
fi
