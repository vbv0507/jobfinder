FROM node:22-bookworm-slim

# Install system dependencies for Playwright/Puppeteer (Chromium) + unzip for Puppeteer browser download
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    unzip \
    gnupg \
    ca-certificates \
    procps \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libdrm2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libxcursor1 \
    libxi6 \
    libxtst6 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

# Skip Puppeteer's own Chrome download — we use Playwright's Chromium instead
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install production deps
RUN npm ci --omit=dev

# Install Playwright Chromium browser
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3000

# Healthcheck hits the dedicated /health endpoint (no auth required)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
