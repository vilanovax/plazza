# Poker PWA — app image (build + custom Next/Socket.IO server).
FROM node:20-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest and build the Next app + the esbuild server bundle.
COPY . .
RUN npm run build

EXPOSE 3000
CMD ["sh", "docker-entrypoint.sh"]
