# API: Fastify + Drizzle + sharp. Roda o TypeScript direto com tsx.
# Debian slim (e nao Alpine) para o sharp usar o binario pronto sem surpresa.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @valenzia/api --include-workspace-root=false --omit=dev

COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
