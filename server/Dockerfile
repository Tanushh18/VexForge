# Build context is the REPO ROOT, not server/ — the server imports shared/
# (model routing, scoring, outreach prompts), which the local worker imports
# too. See dockerContext in render.yaml.

FROM node:22-bookworm-slim

WORKDIR /app

# Dependencies first, so a source-only change doesn't reinstall them.
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# No Playwright here by design. Chromium costs ~730MB resident, which would
# force a 2GB instance for a process that otherwise idles at ~140MB — so
# discovery and deep scans run on the local worker instead, and this image
# stays small enough for a 512MB plan.
COPY shared/ ./shared/
COPY server/ ./server/

WORKDIR /app/server
ENV NODE_ENV=production
# Render injects PORT and the app reads it; this is just the local default.
EXPOSE 4000

CMD ["node", "src/index.js"]
