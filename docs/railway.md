# Publicar en Railway

La app se despliega como **un solo servicio** (API + web compilada, ver `Dockerfile`) más una base
**PostgreSQL** y un **volumen** para las fotos, videos y facturas. Costo aproximado: el plan Hobby de
Railway cubre un taller piloto; la base y el volumen se cobran por uso.

## 1. Preparar el repositorio

1. Sube el repo a GitHub (privado). **Nunca** subas `.env`, respaldos `.dump` ni la carpeta `datos/`
   (ya están en `.gitignore`).
2. Opcional pero recomendado: haz el despliegue desde la rama `main` una vez que `mvp-lanzamiento` esté fusionada.

## 2. Crear el proyecto

1. En Railway: **New Project → Deploy from GitHub repo** y elige el repositorio. Railway detecta el
   `Dockerfile` y `railway.json`.
2. En el mismo proyecto: **New → Database → Add PostgreSQL**.
3. En el servicio de la app: **Settings → Volumes → New Volume**, punto de montaje `/data`.
   Ahí se guardan fotos, videos y documentos de compra (`UPLOADS_DIR=/data/uploads`). Sin volumen se
   pierden en cada despliegue.

## 3. Variables del servicio de la app

| Variable | Valor | Para qué |
|---|---|---|
| `DATABASE_URL_ADMIN` | `${{Postgres.DATABASE_URL}}` | Dueño de la base: crea el esquema, aplica migraciones y el usuario de la app. |
| `APP_DB_PASSWORD` | una clave larga y aleatoria (mín. 16 caracteres) | Clave del usuario `taller_app`, con el que se conecta la API. |
| `SESSION_SECRET` | una cadena aleatoria de 32+ caracteres | Firma las sesiones. La app no arranca en producción sin ella. |
| `SUPERADMIN_EMAIL` | tu correo | Crea tu usuario de plataforma la primera vez. |
| `SUPERADMIN_PASSWORD` | una clave de 10+ caracteres | Idem. Cámbiala después con `create-superadmin` si quieres. |
| `ANTHROPIC_API_KEY` | tu clave de la API de Anthropic | **Opcional.** Sin ella solo se leen facturas en XML; con ella también PDF y fotos. |

No definas `DATABASE_URL`: la API la arma sola con `taller_app` + `APP_DB_PASSWORD`.
Generar claves: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## 4. Primer arranque

Al desplegar, el contenedor corre `scripts/bootstrap` antes de la API (es idempotente):

1. base vacía → crea el esquema completo; base existente → aplica solo las migraciones nuevas
   (registradas en la tabla `schema_migrations`);
2. crea o actualiza el usuario `taller_app` (sin superusuario ni `BYPASSRLS`, para que los talleres
   queden aislados por Row Level Security);
3. crea el superadmin si todavía no existe.

Luego **Settings → Networking → Generate Domain** para tener la URL pública (HTTPS). El healthcheck es
`/api/healthz`. Entra con tu superadmin → `/plataforma` → crea el primer taller (nombre, administrador
y clave inicial). Ese administrador sigue la guía "Deja tu taller listo" en Inicio.

## 5. Actualizar

Cada `git push` a la rama conectada despliega de nuevo. Las migraciones nuevas se aplican solas.
Si cambias el esquema, agrega `lib/db/migrations/NNN-nombre.sql` (idempotente) y regenera
`lib/db/schema.sql` (ver README).

## 6. Respaldos y seguridad

- **Base:** activa los backups de Railway para el servicio PostgreSQL o programa un `pg_dump` periódico
  (`pg_dump "$DATABASE_URL" > respaldo.dump`, guardado fuera del repositorio).
- **Volumen:** contiene datos de clientes (fotos de sus bicicletas, facturas). Respáldalo también.
- Cambiar `APP_DB_PASSWORD` y redeplegar rota la clave del usuario de la API.
- Dominio propio: **Settings → Networking → Custom Domain** y el CNAME que indique Railway.
- Los enlaces que se mandan a los clientes (`/ot/<token>`) no requieren login; el token es secreto y largo.

## 7. Probar la imagen en tu computador

```bash
docker build -t taller-bicis .
docker run --rm -p 8080:8080 -e PORT=8080 \
  -e DATABASE_URL_ADMIN=postgresql://taller:taller@host.docker.internal:5432/taller_prueba \
  -e APP_DB_PASSWORD=una-clave-larga-123456 \
  -e SESSION_SECRET=una-cadena-aleatoria-de-32-caracteres-o-mas \
  -e SUPERADMIN_EMAIL=tu@correo.cl -e SUPERADMIN_PASSWORD=una-clave-larga \
  taller-bicis
```

(la base `taller_prueba` debe existir y estar vacía.)
