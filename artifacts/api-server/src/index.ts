import app from "./app";
import { logger } from "./lib/logger";
import { checkRlsRole } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Los talleres solo quedan aislados si el usuario de la base respeta Row Level Security.
const rls = await checkRlsRole();
if (rls.bypassesRls) {
  const msg = `El usuario de base de datos "${rls.user}" es superusuario o tiene BYPASSRLS: los talleres NO quedan aislados. Conéctate con un usuario normal (ver README).`;
  if (process.env.NODE_ENV === "production") {
    logger.fatal(msg);
    process.exit(1);
  }
  logger.warn(msg);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
