import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerStudioRoutes } from "./routes/studio.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

await registerCatalogRoutes(app);
await registerRenderRoutes(app);
await registerStudioRoutes(app);

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).then(() => {
  app.log.info("API running on http://" + host + ":" + port);
}).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
