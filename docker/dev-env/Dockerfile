# Dev environment container for aesir dev-agent
# Provides Node.js, pnpm, and code exploration tools
#
# Usage:
#   docker build -t aesir-dev-env:latest -f docker/dev-env/Dockerfile docker/dev-env/
#   docker run -d --name dev-env aesir-dev-env:latest

FROM node:20-slim

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install system packages for development
# - git: version control
# - ripgrep: fast code search (binary: rg)
# - fd-find: fast file finder (binary: fdfind, symlinked to fd)
# - jq: JSON processing
# - curl: HTTP requests
# - ca-certificates: HTTPS support
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    fd-find \
    jq \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh)
# Reference: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Create symlink for fd-find (Debian names binary fdfind to avoid conflict with fdclone)
RUN ln -s $(which fdfind) /usr/local/bin/fd

# Set working directory for workspace
WORKDIR /workspace

# Keep container running (dev-agent manages lifecycle via Docker API)
# No ENTRYPOINT - CMD only for flexibility
CMD ["sleep", "infinity"]
