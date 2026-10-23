import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool, runWithTenantConnection } from "@workspace/db";
import "./lib/session";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const production = process.env.NODE_ENV === "production";

// Detrás del proxy del hosting (Railway, etc.) para que las cookies "secure" y la IP funcionen.
if (production || process.env.TRUST_PROXY) app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// El frontend se sirve en el mismo dominio que /api, así que no hace falta CORS.
// Para permitir otros orígenes, definir CORS_ORIGINS="https://a.cl,https://b.cl".
const corsOrigins = process.env.CORS_ORIGINS?.split(",").map(o => o.trim()).filter(Boolean) ?? [];
if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET || "taller-bicicleta-dev-secret-change-in-prod";
if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("En producción SESSION_SECRET debe tener al menos 32 caracteres.");
}

// Sesiones en Postgres: reiniciar la API no cierra la sesión de nadie.
// La tabla la crea lib/db/migrations/004-sesiones.sql.
const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({ pool, tableName: "session" }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // "auto": segura cuando la conexión es HTTPS (detrás del proxy); en http local sigue funcionando.
      secure: production ? "auto" : false,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

// Cada request usa su propia conexión fijada al taller de la sesión (Row Level Security).
// La conexión se devuelve al pool cuando termina la respuesta.
app.use("/api", (req, res, next) => {
  const done = new Promise<void>((resolve) => {
    res.once("finish", resolve);
    res.once("close", resolve);
  });
  runWithTenantConnection(req.session.workshopId ?? null, done, () => next()).catch(next);
});

app.use("/api", router);

// Producción: la misma app sirve la web ya compilada (WEB_DIST) y deja que el router del navegador
// resuelva cualquier ruta que no sea /api.
const webDist = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null;
if (webDist && fs.existsSync(path.join(webDist, "index.html"))) {
  app.use("/assets", express.static(path.join(webDist, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(webDist, {
    index: false, maxAge: "1h",
    // El service worker y el manifiesto no se cachean: una versión nueva debe llegar al abrir la app.
    setHeaders: (res, file) => { if (/(sw\.js|manifest\.webmanifest)$/.test(file)) res.setHeader("Cache-Control", "no-cache"); },
  }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.set("Cache-Control", "no-cache").sendFile(path.join(webDist, "index.html"));
  });
}

export default app;
