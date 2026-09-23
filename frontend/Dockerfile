# Build the PWA and serve it from nginx.
#
# The Service Worker is what makes Smaran work in a village with no signal, so
# the nginx config below is careful about two things: the worker itself must
# never be cached (or a device can be stuck on an old one forever), and every
# route must fall through to index.html so a deep link opens the app rather
# than a 404.

FROM node:22-alpine AS build
WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
