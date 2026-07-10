import { serve } from "@hono/node-server";
import { createApp, VERSION } from "./app.js";
import { loadConfig } from "./config.js";
import { ensureDomainsDir } from "./bootstrap.js";

const config = loadConfig();

const bootstrap = ensureDomainsDir(config);
if (bootstrap.created) {
  console.log(`Outpost created an empty domains root at ${bootstrap.to}`);
}

const app = createApp(config);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Outpost v${VERSION} listening on http://${config.host}:${info.port} ` +
      `(domains: ${config.domainsDir})`,
  );
});
