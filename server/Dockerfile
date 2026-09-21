FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first so a source-only change doesn't re-run the
# (slow) browser install below.
COPY package*.json ./
RUN npm ci --omit=dev

# Chromium for lead discovery and the deep contact scan. Installed via
# Playwright's own CLI rather than from a pinned mcr.microsoft.com/playwright
# base image: the CLI installs the browser build matching whatever version
# package-lock.json resolved, so the two can't drift apart. `--with-deps`
# pulls the system libraries the slim image doesn't ship.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
# Render injects PORT and the app reads it; this is just the local default.
EXPOSE 4000

CMD ["node", "src/index.js"]
