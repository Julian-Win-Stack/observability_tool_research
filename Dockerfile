# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package-lock.json* ./frontend/

# Install all dependencies (root + frontend)
RUN npm ci --prefix . 2>/dev/null || npm install --prefix .
RUN npm ci --prefix frontend 2>/dev/null || npm install --prefix frontend

# Copy source code
COPY . .

# Build frontend (VITE_API_URL comes from frontend/.env.production)
RUN npm run build --prefix frontend

# Build backend
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Copy only production backend deps (we only need runtime deps for the server)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy built backend and frontend
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# API keys are passed at runtime via --env-file (not baked into image)
EXPOSE 3000

CMD ["node", "dist/server.js"]
