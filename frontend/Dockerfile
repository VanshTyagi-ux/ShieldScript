# The React site as a static site behind nginx. Build context is frontend/:
#
#   docker build -t xss-frontend frontend
#
# nginx serves the site and forwards /api/ to the backend (see nginx.conf), so the browser only ever talks to one
# origin: no CORS, and the strict Content-Security-Policy still holds.

# ---- build: bundle the site with esbuild (Node is only needed here) ---------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# `npm run build:dist` reads .env.docker: VITE_API_URL=/api/v1, VITE_BACKEND_PAGES=true. Build arguments override
# it, for a backend that is reachable somewhere else, e.g. --build-arg VITE_API_URL=https://api.example.com/api/v1
ARG VITE_API_URL
ARG VITE_BACKEND_PAGES
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_BACKEND_PAGES=${VITE_BACKEND_PAGES}
COPY .env.docker ./
COPY scripts/ scripts/
COPY src/ src/
RUN npm run build:dist

# ---- runtime: nginx that runs as a non-root user, on port 8080 --------------------------------------------
FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
