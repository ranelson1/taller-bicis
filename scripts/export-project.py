"""Create a private, portable source and PostgreSQL backup without printing secrets."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "generated-artifacts"
SKIP_DIRS = {
    ".git", ".local", ".agents", ".cache", ".config", ".upm", ".pythonlibs",
    "node_modules", "dist", "generated-artifacts", "__pycache__", ".pnpm-store",
}
SKIP_FILES = {".env", ".env.local", ".env.production", ".env.development"}


def run_private(command, env=None):
    result = subprocess.run(command, env=env, capture_output=True)
    if result.returncode:
        # PostgreSQL errors can contain connection details; do not echo them.
        raise RuntimeError(f"{command[0]} failed; no archive was delivered.")
    return result.stdout


def main():
    OUTPUT.mkdir(exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    destination = OUTPUT / f"taller-bicicletas-completo-{stamp}.zip"
    env = os.environ.copy()
    if not env.get("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is required to export the database.")
    # Pass the URI directly to libpq without printing it or storing it in the ZIP.
    with tempfile.TemporaryDirectory(prefix="taller-export-") as temporary:
        temp = Path(temporary)
        dump = temp / "base-datos.dump"
        sql = temp / "base-datos.sql"
        run_private([
            "pg_dump", "--format=custom", "--no-owner", "--no-privileges",
            "--dbname", env["DATABASE_URL"], "--file", str(dump),
        ], env)
        listing = run_private(["pg_restore", "--list", str(dump)])
        run_private([
            "pg_restore", "--no-owner", "--no-privileges",
            "--file", str(sql), str(dump),
        ])
        sources = []
        for current, dirs, files in os.walk(ROOT):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for name in sorted(files):
                path = Path(current) / name
                if (path.is_symlink() or name in SKIP_FILES
                        or name.startswith(".env.") and name != ".env.example"
                        or name.endswith((".tsbuildinfo", ".log", ".pem", ".key"))):
                    continue
                sources.append(path)
        readme = """# Respaldo completo — Taller de Bicicletas

## Contenido y privacidad
- codigo/: código actual completo, configuración, dependencias declaradas y lockfile,
  contrato API, esquema DB, frontend, backend, prototipos, adjuntos y manual.
- datos/base-datos.dump: respaldo PostgreSQL en formato custom.
- datos/base-datos.sql: el mismo respaldo en SQL legible; es una alternativa, no
  debe restaurarse además del archivo .dump.
- datos/contenido-respaldo.txt: inventario de objetos y tablas del respaldo.
- MANIFIESTO.json: fecha UTC, origen, archivos y verificaciones SHA-256.

La base incluye todas las tablas y registros (también inactivos), relaciones,
secuencias y contraseñas de usuarios en su formato hash original. Tratar este ZIP
como confidencial: contiene datos personales. No subir a un repositorio público.
No incluye secretos del entorno, credenciales de conexión, sesiones en memoria,
historial Git, conversaciones del agente, dependencias instaladas ni cachés.
Se exportó la base de desarrollo actual; no había una publicación activa al exportar.
Los archivos de código conservan sus valores de ejemplo y seeds de desarrollo.

## Requisitos del destino
Node.js 24, pnpm 10 (o compatible con pnpm-lock.yaml), PostgreSQL de la misma
versión mayor del origen o una superior, y herramientas psql/pg_restore.
Las versiones de herramientas de exportación constan en MANIFIESTO.json.

## 1. Restaurar los datos
Crear una base PostgreSQL VACÍA. Configurar DATABASE_URL en el gestor de secretos
del destino (no compartirla por chat ni guardarla en Git).
En una terminal que ya tenga esa variable:

    pg_restore --dbname="$DATABASE_URL" --no-owner --no-privileges --exit-on-error datos/base-datos.dump

Alternativa (usar SOLO si no se utilizó el comando anterior):

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f datos/base-datos.sql

No ejecutar seeds, ni restaurar encima de una base con datos existentes.
La exportación no modifica ni elimina datos de la aplicación original.

## 2. Instalar la app

    cd codigo
    pnpm install --frozen-lockfile

Configurar DATABASE_URL y un SESSION_SECRET nuevo, largo y aleatorio, en el entorno
del servidor. Usar ENV.example únicamente como referencia de nombres; la app no
carga automáticamente archivos .env.

## 3. Desarrollo fuera de Replit
Dos procesos, desde codigo/ y con las variables configuradas:

    PORT=8080 pnpm --filter @workspace/api-server run dev
    PORT=5173 BASE_PATH=/ pnpm --filter @workspace/workshop-app run dev

IMPORTANTE: fuera de Replit se necesita un proxy que entregue /api al backend y
el resto al frontend bajo el MISMO dominio. Abrir solo el puerto 5173 no basta:
sin el proxy no funcionarán login ni consultas.

## 4. Producción fuera de Replit

    pnpm --filter @workspace/api-server run build
    PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/workshop-app run build
    PORT=8080 NODE_ENV=production pnpm --filter @workspace/api-server run start

Servir codigo/artifacts/workshop-app/dist/public como archivos estáticos, con
fallback a index.html para las rutas de React. Dirigir /api al proceso del backend
sin quitar el prefijo /api. Ejemplo de Nginx (ajustar dominio, ruta y HTTPS):

    server {
        listen 80;
        server_name taller.example.com;
        root /ruta/codigo/artifacts/workshop-app/dist/public;
        location /api/ {
            proxy_pass http://127.0.0.1:8080;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
        location / { try_files $uri $uri/ /index.html; }
    }

Los archivos .replit-artifact describen los servicios originales; otro hosting
no los configura automáticamente. Es necesario configurar el proxy y procesos.
Los prototipos del canvas no son necesarios para ejecutar la app del taller.

## Seguridad y comprobación tras el traslado
- Los usuarios conservan su acceso con las contraseñas originales si no se cambian.
- Cambiar cuentas/contraseñas demo antes de exponer el sistema a Internet.
- La app actual usa sesiones en memoria: reiniciar el backend cierra sesiones;
  para varios procesos o producción duradera se necesita un almacén persistente.
- Configurar HTTPS y revisar cookies seguras/trust proxy antes de uso público.
- Revisar login, clientes, bicicletas, presupuestos, recepciones y órdenes.
- Comparar cantidades y totales con la instalación original antes de dejar de usarla.
- Este ZIP es un respaldo para migración; no se ha instalado ni probado en el destino.
"""
        manifest = {
            "createdAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "databaseEnvironment": "development",
            "activePublishedDeployment": False,
            "pgDumpVersion": run_private(["pg_dump", "--version"]).decode().strip(),
            "secretsIncluded": False,
            "files": {},
        }
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
            def add(name, data):
                archive.writestr("taller-bicicletas/" + name, data)
                manifest["files"][name] = {
                    "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                }
            for source in sources:
                add("codigo/" + source.relative_to(ROOT).as_posix(), source.read_bytes())
            add("datos/base-datos.dump", dump.read_bytes())
            add("datos/base-datos.sql", sql.read_bytes())
            add("datos/contenido-respaldo.txt", listing)
            add("LEEME-TRASLADO.md", readme.encode())
            add("ENV.example", b"DATABASE_URL=<configurar-en-el-destino>\nSESSION_SECRET=<generar-uno-nuevo>\n")
            archive.writestr(
                "taller-bicicletas/MANIFIESTO.json",
                json.dumps(manifest, ensure_ascii=False, indent=2),
            )
        with zipfile.ZipFile(destination) as archive:
            if archive.testzip() is not None:
                raise RuntimeError("ZIP integrity check failed.")
            for name, metadata in manifest["files"].items():
                actual = archive.read("taller-bicicletas/" + name)
                if hashlib.sha256(actual).hexdigest() != metadata["sha256"]:
                    raise RuntimeError("Checksum verification failed.")
        print(json.dumps({
            "path": str(destination.relative_to(ROOT)), "bytes": destination.stat().st_size,
            "files": len(manifest["files"]), "databaseDumpBytes": dump.stat().st_size,
            "verified": True,
        }))


if __name__ == "__main__":
    main()
