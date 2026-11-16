# syntax=docker/dockerfile:1
# Production image: Node 24 LTS + Perl (ExifTool) + jpegtran (lossless JPEG rotation).

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Baked into prerendered pages (canonical URLs, Open Graph, sitemap): pass with
#   docker build --build-arg NEXT_PUBLIC_SITE_URL=https://your.domain .
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CLEANFRAME_TEMP_DIR=/tmp/cleanframe
RUN apt-get update \
 && apt-get install -y --no-install-recommends perl libjpeg-turbo-progs \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /tmp/cleanframe && chown node:node /tmp/cleanframe && chmod 700 /tmp/cleanframe
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
