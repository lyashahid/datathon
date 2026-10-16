# syntax=docker/dockerfile:1
# Build-time public setting only. Secrets are injected at runtime by Compose.
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.ts tsconfig.json ./
COPY src ./src
COPY static ./static
ARG PUBLIC_BASE_PATH=/apps/datathon
ENV PUBLIC_BASE_PATH=${PUBLIC_BASE_PATH}
RUN npm run build

FROM node:24-bookworm-slim AS frontend
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BODY_SIZE_LIMIT=16M
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=frontend-build /app/build ./build
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/apps/datathon').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/index.js"]

FROM python:3.14-slim-bookworm AS backend
COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /uvx /bin/
WORKDIR /app/backend
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/tmp \
    MOBILITY_ENVIRONMENT=production \
    MOBILITY_COMPUTED_CACHE_POSTGRES_ENABLED=false \
    MOBILITY_DATA_DIR=/app/backend/data \
    MOBILITY_PUBLIC_DATA_DIR=/app/data/public
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project \
    && /opt/venv/bin/python -m playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/* /root/.cache
COPY backend/app ./app
COPY backend/vendor ./vendor
# Authoritative snapshots are immutable image inputs, never imported into the DB.
COPY backend/data/cache/normalized ./data/cache/normalized
COPY backend/data/cache/graphs ./data/cache/graphs
COPY backend/data/cache/derived ./data/cache/derived
COPY backend/data/metadata ./data/metadata
COPY data/public /app/data/public
RUN mkdir -p data/cache/raw/live data/cache/live data/runtime data/metadata/forecast-issues \
    && chown -R 10001:10001 data/runtime data/cache/live data/cache/raw/live data/metadata/forecast-issues
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=5 \
  CMD /opt/venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4)"
CMD ["/opt/venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
