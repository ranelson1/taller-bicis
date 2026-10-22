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
      secure: false,
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

export default app;
