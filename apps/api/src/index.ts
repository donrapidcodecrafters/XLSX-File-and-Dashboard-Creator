import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerQuickbaseRoutes } from "./routes/quickbase.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerStudioRoutes } from "./routes/studio.js";
import { startRefreshScheduler } from "./services/refresh-cache.js";

const app = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024
});
const currentDir = dirname(fileURLToPath(import.meta.url));
const webDistDir = resolve(currentDir, "../../web/dist");
const hasBuiltWeb = existsSync(resolve(webDistDir, "index.html"));

await app.register(cors, {
  origin: true
});
await app.register(formbody);

await registerCatalogRoutes(app);
await registerQuickbaseRoutes(app);
await registerRenderRoutes(app);
await registerStudioRoutes(app);

if (hasBuiltWeb) {
  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: "/",
    wildcard: false
  });

  app.get("/", async (_request, reply) => {
    return reply.sendFile("index.html");
  });

  app.head("/", async (_request, reply) => {
    reply.code(200).send();
  });

  app.get<{ Params: { "*": string } }>("/*", async (request, reply) => {
    const path = request.params["*"] || "";
    if (path.startsWith("api/")) {
      reply.code(404).send({ message: "Not found" });
      return;
    }
    if (path.includes(".")) {
      reply.code(404).send({ message: "Not found" });
      return;
    }
    return reply.sendFile("index.html");
  });
}

startRefreshScheduler(app.log);

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).then(() => {
  app.log.info("API running on http://" + host + ":" + port);
}).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
