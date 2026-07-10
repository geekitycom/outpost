import { serve } from "@hono/node-server";
import { createApp, VERSION } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Outpost v${VERSION} listening on http://${config.host}:${info.port} ` +
      `(domains: ${config.domainsDir})`,
  );
});
