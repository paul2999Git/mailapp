# ---------- Build Stage ----------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install system dependencies needed by Prisma
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy root config
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy workspace packages
COPY prisma ./prisma
COPY shared ./shared
COPY server ./server
COPY workers ./workers
COPY client ./client

# Install all workspace dependencies
RUN npm install
RUN npx prisma generate

# Build in correct dependency order
RUN cd shared && npm run build
RUN cd server && npm run build
RUN cd workers && npm run build
RUN cd client && npm run build


# ---------- Runtime Stage ----------
FROM node:20-bookworm-slim

WORKDIR /app

# Install runtime dependencies for Prisma
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Copy full built workspace (preserves monorepo resolution)
COPY --from=builder /app /app

EXPOSE 4001

CMD ["node", "server/dist/index.js"]
