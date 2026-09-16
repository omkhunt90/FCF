# FCF Frontend Dockerfile — build + nginx serve
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production: serve with nginx
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config: SPA routing support
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
