FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.172.0 @anthropic-ai/claude-code@2.1.331
COPY server/probe.mjs /opt/agent-watch/probe.mjs
USER node
WORKDIR /workspace
ENV HOME=/tmp/home
CMD ["node", "/opt/agent-watch/probe.mjs"]
