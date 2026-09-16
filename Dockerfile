# A2A cards server (issue #5).
#
# Publishes the public A2A agent cards over HTTP. The server has ZERO runtime
# dependencies — it uses only the Node built-in http module plus the committed
# role assets — so there is no npm install step and no package registry is
# contacted at build time. It needs no credentials of any kind; none are copied
# into the image, set in ENV, or present in any layer.
#
# Base pinned by explicit version AND digest (Node 22 LTS on Alpine).
FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

ENV NODE_ENV=production
WORKDIR /app

# Copy only what the server needs to run. The installer's renderers/config, the
# tests, and node_modules are intentionally excluded (see .dockerignore); the
# explicit COPY list below is the real allowlist.
COPY package.json ./
COPY bin/a2a-server.js ./bin/a2a-server.js
COPY src/a2a ./src/a2a
COPY src/roles ./src/roles
COPY assets/roles ./assets/roles

# Run as the image's built-in non-root user. The server only reads files.
USER node

# Documented default port. Override PORT / PUBLIC_BASE_URL at runtime.
ENV PORT=8080
EXPOSE 8080

# Liveness against the server's own health route (Node 22 has global fetch).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "bin/a2a-server.js"]
