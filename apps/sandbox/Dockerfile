FROM node:26-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV NODE_OPTIONS=--max-old-space-size=128
# Host firewall denies outbound traffic from this container.
# Browsers and other toolchains are cached in PLAYWRIGHT_BROWSERS_PATH and are not downloaded per job.
COPY package.json ./
COPY src ./src
CMD ["node", "--experimental-strip-types", "src/server.ts"]
