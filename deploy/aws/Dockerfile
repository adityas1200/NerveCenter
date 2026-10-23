# syntax=docker/dockerfile:1
#
# Production images for the two CodePipeline components. The build context is
# the repository root (docker build -f deploy/aws/Dockerfile .); select the image with
# --target frontend or backend.

FROM node:22-alpine AS frontend-build
WORKDIR /app

# Vite embeds these values at build time. The paths are empty by default so .env.defaults can
# supply them (vite.config.ts): dev serves at /nervecenter, sandbox at /apps/nervecenter.
# Compose always passes both, derived from PUBLIC_BASE_PATH.
ARG VITE_APP_BASE=
ARG VITE_API_BASE_URL=
ARG VITE_AUTO_REFRESH_SECONDS=
ARG VITE_AZURE_SSO_ENABLED=true
ARG VITE_AUTH_ENABLED=true
# Empty by default so .env.defaults can supply it (vite.config.ts); compose always passes one.
# With neither, src/auth-session.ts falls back to the sandbox path /dataverse/apps/api/v1.
ARG VITE_AUTH_API_BASE_URL=
ENV VITE_APP_BASE=$VITE_APP_BASE \
  VITE_API_BASE_URL=$VITE_API_BASE_URL \
  VITE_AUTO_REFRESH_SECONDS=$VITE_AUTO_REFRESH_SECONDS \
  VITE_AZURE_SSO_ENABLED=$VITE_AZURE_SSO_ENABLED \
  VITE_AUTH_ENABLED=$VITE_AUTH_ENABLED \
  VITE_AUTH_API_BASE_URL=$VITE_AUTH_API_BASE_URL

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY .env.defaults ./.env.defaults
RUN npm run build

FROM nginx:1.27-alpine AS frontend
COPY deploy/aws/nginx.conf /etc/nginx/templates/default.conf.template
# PUBLIC_BASE_PATH and friends from .env.defaults when the container was not given them; the
# hook runs before the template is rendered (14 < 20-envsubst-on-templates.sh).
COPY .env.defaults /etc/nginx/nervecenter.env.defaults
COPY --chmod=0755 deploy/aws/nginx-env-defaults.envsh /docker-entrypoint.d/14-nervecenter-env-defaults.envsh
COPY --from=frontend-build /app/dist /usr/share/nginx/html
# NGINX_LISTEN_PORT is injected into nginx.conf at container start via envsubst. 8787 matches the
# dev k8s Deployment's containerPort and Service targetPort; compose sets its own.
ENV NGINX_LISTEN_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:${NGINX_LISTEN_PORT:-8787}/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]

FROM node:22-bookworm-slim AS backend-dependencies
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS backend-build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run typecheck && npm run build

# The backend runs the Claude Agent SDK with the vendored operations-fleet plugin. Agent sessions
# need git (Knowledge clones, the plugin's build skill) and uv/uvx plus Python (the MCP servers the
# Connectors page configures by default: mcp-atlassian, mcp-databricks-server, servicenow-mcp,
# mcp-snowflake-server). npx is already present through Node.
#
# The documents, data-pull and communication skills build and check files with Python scripts:
# python-docx, openpyxl, python-pptx and matplotlib build them, headless LibreOffice converts them to
# PDF and recalculates workbooks, and poppler turns pages into images the agent can look at.
FROM node:22-bookworm-slim AS backend
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gh python3 python3-venv \
       libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
       poppler-utils fonts-dejavu-core fonts-liberation2 \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh \
    && python3 -m venv /opt/ops-python \
    && /opt/ops-python/bin/pip install --no-cache-dir \
       "python-docx~=1.1" "openpyxl~=3.1" "python-pptx~=1.0" "matplotlib~=3.9" "pypdf~=5.0" "PyYAML~=6.0"
WORKDIR /app
# /opt/ops-python/bin first, so `python` and `python3` in agent sessions have the document libraries.
ENV PATH=/opt/ops-python/bin:$PATH \
    MPLCONFIGDIR=/tmp/matplotlib
# PORT=8787 matches the dev k8s Deployment's containerPort and Service targetPort, and compose.
# USE_AWS_SECRETS is deliberately not set here: .env.defaults sets it to auto, as ai_for_data
# does, so dev reads DB and S3 settings from beacon/<env>/common. Hydration only fills
# variables that are unset or blank, so anything the k8s Secret injects via envFrom still wins.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    OPS_RUNTIME_DIR=/var/lib/nervecenter/runtime \
    OPS_WORKSPACE_DIR=/var/lib/nervecenter/workspace \
    OPS_PLUGIN_DIR=/app/plugin/operations-fleet \
    UV_CACHE_DIR=/var/lib/nervecenter/uv-cache \
    UV_PYTHON_INSTALL_DIR=/var/lib/nervecenter/uv-python

COPY --from=backend-dependencies /app/node_modules ./node_modules
COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node backend/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=backend-build --chown=node:node /app/dist ./dist
COPY --chown=node:node backend/migrations ./migrations
# The tracked defaults, applied at boot by src/env-defaults.mjs. On k8s nothing else reads them.
COPY --chown=node:node .env.defaults ./.env.defaults
COPY --chown=node:node plugin/operations-fleet/ ./plugin/operations-fleet/
RUN node --input-type=module -e "await import('./migrations/006-project-access.mjs')"
RUN mkdir -p /var/lib/nervecenter/runtime /var/lib/nervecenter/workspace /var/lib/nervecenter/uv-cache /var/lib/nervecenter/uv-python \
    && chown -R node:node /var/lib/nervecenter

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]

# Keep this stage LAST. The TeamCity jobs for nervecenter-api and nervecenter-ui both run a plain
# `docker build` with no --target, so both get whatever comes last. It is the backend image plus
# the built frontend, and docker-entrypoint.sh picks the role per pod: the UI Deployment (pod name
# contains -nervecenter-ui-) serves the frontend and starts no backend; every other pod runs the
# backend exactly as the stage above. Compose builds name their target, so they never build this.
# Once the UI job passes --target frontend, this stage and backend/docker-entrypoint.sh can go.
FROM backend AS combined
COPY --from=frontend-build --chown=node:node /app/dist ./ui-dist
CMD ["sh", "docker-entrypoint.sh"]
