# ---- Webmail production image ----
FROM node:22-alpine

# Small init so the container reaps zombies and forwards signals cleanly.
RUN apk add --no-cache tini

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

# Install only production dependencies (leverages the layer cache).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source.
COPY . .

# Persistent data dir (SQLite DB + encryption key), owned by the runtime user.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

# Run as the built-in unprivileged user.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
