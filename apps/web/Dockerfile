# Front: o Vite gera os arquivos estaticos, o nginx serve e faz proxy de /api.
FROM node:24-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @valenzia/web --include-workspace-root

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @valenzia/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
