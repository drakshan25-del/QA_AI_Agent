# Multi-stage build for the React (Vite) frontend (V2_CONTRACT §7, port 5173 in
# dev; served as static assets on :80 in the container).

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

# Vite inlines VITE_* at build time, so they are supplied as build args.
ARG VITE_API_BASE=http://localhost:4000/api/v2
ARG VITE_WS_BASE=ws://localhost:4000
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_WS_BASE=$VITE_WS_BASE

COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
