import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerQuickbaseRoutes } from "./routes/quickbase.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerStudioRoutes } from "./routes/studio.js";
import { startRefreshScheduler } from "./services/refresh-cache.js";

const app = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024
});

await app.register(cors, {
  origin: true
});
await app.register(formbody);

await registerCatalogRoutes(app);
await registerQuickbaseRoutes(app);
await registerRenderRoutes(app);
await registerStudioRoutes(app);
startRefreshScheduler(app.log);

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).then(() => {
  app.log.info("API running on http://" + host + ":" + port);
}).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
