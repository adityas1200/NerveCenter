FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git gh && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --chown=node:node . .
ENV HOST=0.0.0.0
ENV PORT=8787
ENV OPS_RUNTIME_DIR=/tmp/ops-agent-runtime
USER node
EXPOSE 8787
CMD ["npm", "start"]
