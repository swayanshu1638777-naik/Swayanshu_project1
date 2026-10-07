FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5000 \
    DATABASE_PATH=/app/data/college_portal.sqlite

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY backend/package.json backend/package-lock.json ./
COPY backend/src ./src
COPY --chown=node:node *.html ./public/
COPY --chown=node:node css ./public/css
COPY --chown=node:node js ./public/js
COPY --chown=node:node assets ./public/assets
RUN mkdir -p /app/data && chown node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
