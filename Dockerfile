# Imagen de producción: una sola app que sirve la API (/api) y la web compilada.
# Railway la usa tal cual (ver docs/railway.md); también sirve para cualquier hosting con Docker.

FROM node:24-slim AS build
RUN npm install -g pnpm@12.14.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/workshop-app run build \
 && pnpm --filter @workspace/api-server run build

FROM node:24-slim
ENV NODE_ENV=production \
    WEB_DIST=/app/web \
    DB_SQL_DIR=/app/db \
    UPLOADS_DIR=/data/uploads
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/workshop-app/dist/public ./web
COPY --from=build /app/lib/db/schema.sql ./db/schema.sql
COPY --from=build /app/lib/db/migrations ./db/migrations
# Las fotos, videos y facturas se guardan en UPLOADS_DIR: monta un volumen en /data para que sobrevivan a los despliegues.
VOLUME ["/data"]
# Antes de arrancar: esquema/migraciones, usuario de la app y superadmin (idempotente).
CMD ["sh", "-c", "node dist/scripts/bootstrap.mjs && node dist/index.mjs"]
