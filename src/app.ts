import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "./config.js";
import { normalizeHost, resolveDomainFolder } from "./domains.js";
import { effectiveConfig, loadDomainConfig } from "./domainConfig.js";
import { resolvePath } from "./resolve.js";
import { serveFile } from "./serve.js";

export const VERSION = "1.0.0";

/** Minimal self-contained 404 page (fuller templating arrives with the renderers). */
const NOT_FOUND_HTML =
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  "<title>404 Not Found</title></head><body>" +
  "<h1>404 Not Found</h1><p>The requested page could not be found.</p>" +
  "</body></html>";

/**
 * Build the Hono app: operational endpoints first, then a catch-all that routes
 * by the requested host to a domain folder and serves/redirects/404s (§3).
 */
export function createApp(config: Config): Hono {
  const app = new Hono();

  // Health check for Docker / Caddy. Matched before any host routing.
  app.get("/healthz", (c) => c.text("ok"));
  app.get("/version", (c) => c.text(VERSION));

  app.all("*", async (c) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    // Determine the host (§3.1): Host header, then optional X-Forwarded-Host.
    let host = normalizeHost(c.req.header("host"));
    if (host === undefined && config.trustForwardedHeaders) {
      host = normalizeHost(c.req.header("x-forwarded-host"));
    }

    if (host === undefined) {
      // Never let a missing/undefined host crash the server — serve 404.
      log(c.req.method, "-", pathname, 404);
      return notFound(c);
    }

    const domainFolder = resolveDomainFolder(host, config);
    // Per-domain config.json overrides for this request (§4). Read per request;
    // a missing/malformed file degrades to global defaults.
    const eff = effectiveConfig(config, loadDomainConfig(domainFolder));
    const result = resolvePath(domainFolder, pathname, eff);

    switch (result.kind) {
      case "redirect": {
        const location = result.location + url.search;
        log(c.req.method, host, pathname, 301);
        return c.redirect(location, 301);
      }
      case "file": {
        // Thread the request slice renderers need for content negotiation
        // (§3.3: `.opml` raw-OPML via Accept header or ?format=opml).
        const res = await serveFile(result.path, eff, {
          accept: c.req.header("accept"),
          format: url.searchParams.get("format") ?? undefined,
        });
        log(c.req.method, host, pathname, res.status);
        return res;
      }
      case "notFound":
      default: {
        log(c.req.method, host, pathname, 404);
        return notFound(c);
      }
    }
  });

  return app;
}

function notFound(c: Context): Response {
  return c.html(NOT_FOUND_HTML, 404);
}

/** Basic stdout request logging: method, host, path, status. */
function log(method: string, host: string, path: string, status: number): void {
  console.log(`${method} ${host} ${path} ${status}`);
}
