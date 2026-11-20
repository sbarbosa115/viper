# Production images (App Platform builds these). Targets: api (also the worker), web.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY e2e/package.json e2e/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
# esbuild ships its binary as an optional platform package, so --ignore-scripts is safe.
RUN npm run build

# Everything is bundled into dist/, so the runtime needs no node_modules.
FROM node:24-slim AS api
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3000
# The worker uses this image with: node dist/worker.js. Migrations: node dist/scripts/migrate.js
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM nginx:1.29-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html/app
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location = /app { return 301 /app/; }\n  location /app/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }\n  location /app/ { try_files $uri /app/index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
