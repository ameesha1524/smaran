# Build the PWA and serve it from nginx.
#
# The Service Worker is what makes Smaran work in a village with no signal, so
# nginx/default.conf.template is careful about it: the worker itself is never cached, and every
# route falls through to index.html so a deep link opens the app. nginx also
# forwards /api to the backend, so the browser sees one origin and CORS never
# comes into it. The image runs as an unprivileged user on port 8080.

FROM node:26-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# The stable line, not an old one: an old base carries old OpenSSL, libexpat and libxml2, and Trivy fails the build
# on those. `apk upgrade` takes the fixes the base image has not rebuilt for yet.
FROM nginxinc/nginx-unprivileged:1.30-alpine
USER root
RUN apk upgrade --no-cache
USER 101
COPY --from=build /build/dist /usr/share/nginx/html
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
ENV BACKEND_URL=http://backend:8080 DNS_RESOLVER=127.0.0.11

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz | grep -q ok || exit 1
