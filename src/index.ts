import { serve } from "@hono/node-server";
import { createApp, VERSION } from "./app.js";
import { loadConfig } from "./config.js";
import { ensureDomainsDir } from "./bootstrap.js";

const config = loadConfig();

const bootstrap = ensureDomainsDir(config);
if (bootstrap.seeded) {
  console.log(`Outpost seeded a fresh domains root at ${bootstrap.to} from ${bootstrap.from}`);
}

const app = createApp(config);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Outpost v${VERSION} listening on http://${config.host}:${info.port} ` +
      `(domains: ${config.domainsDir})`,
  );
});
