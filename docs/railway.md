# Publicar en Railway

La app se despliega como **un solo servicio** (API + web compilada, ver `Dockerfile`) más una base
**PostgreSQL** y un **volumen** para las fotos, videos y facturas. Costo aproximado: el plan Hobby de
Railway cubre un taller piloto; la base y el volumen se cobran por uso.

## 1. Preparar el repositorio

1. El repo ya está en GitHub (`ranelson1/taller-bicis`, privado). **Nunca** subas `.env`, respaldos `.dump`
   ni la carpeta `datos/` (ya están en `.gitignore`).
2. Despliega desde la rama **`main`**: `mvp-lanzamiento` ya está fusionada y ambas apuntan al mismo commit.

## 2. Crear el proyecto

1. En Railway: **New Project → Deploy from GitHub repo**, elige el repositorio y la rama `main`. Railway
   detecta el `Dockerfile` y `railway.json`.
2. En el mismo proyecto: **New → Database → Add PostgreSQL**.
3. En el servicio de la app: **Settings → Volumes → New Volume**, punto de montaje `/data`.
   Ahí se guardan fotos, videos, notas de voz y documentos de compra (`UPLOADS_DIR=/data/uploads`). Sin
   volumen se pierden en cada despliegue. Los videos pesan: parte con 5 GB y sube si hace falta.

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

### Cargar el catálogo del taller (opcional)

Con la URL pública ya funcionando, desde tu computador (el repo con `pnpm install` hecho) puedes cargar los
servicios y precios reales de Ridemec, con sus pasos, como el administrador del taller:

```bash
API_URL=https://tu-app.up.railway.app CATALOG_ADMIN="admin@taller.cl:<clave>" \
  pnpm --filter @workspace/api-server run load-catalogo seed/catalogo-ridemec.json
```

Es idempotente: lo que ya existe (por nombre) no se duplica. El taller demo (`load-demo`) **no** se
carga en producción; sirve solo para probar en tu computador.

## 4b. Instalar en el celular y probar cámara y voz

La cámara y el micrófono solo funcionan en HTTPS, y el dominio de Railway ya lo es. Con el celular del mecánico:

1. Abre la URL en Safari (iPhone) o Chrome (Android) → **Compartir / menú → Agregar a la pantalla de inicio**.
   Queda como app, con icono propio.
2. Crea un trabajo de prueba y toca **Foto**: debe abrir la cámara trasera. Sube también un video corto
   (hasta 100 MB).
3. En la ficha, graba una **nota de voz** (hasta 25 MB) y acepta el permiso del micrófono. Abre el link del
   cliente (`/ot/<token>`) desde otro teléfono y confirma que se ve la foto y se escucha el audio.
4. Prueba **Cotizar y reservar**: debe armar el mensaje de WhatsApp con total y fechas.

Si algo de esto falla en el teléfono, anótalo antes de que Ale lo use: es lo único que no se puede probar
desde el computador.

## 5. Actualizar

Cada `git push` a `main` (la rama conectada) despliega de nuevo. Las migraciones nuevas se aplican solas.
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
