import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "./config.js";
import { normalizeHost, domainSearchRoots } from "./domains.js";
import { effectiveConfig, loadDomainConfigCascade } from "./domainConfig.js";
import { resolveInRoots } from "./resolve.js";
import { serveFile } from "./serve.js";
import {
  loadTemplateSource,
  NOT_FOUND_FALLBACK,
  renderTemplate,
} from "./render/templates.js";

export const VERSION = "1.0.0";

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
      // Never let a missing/undefined host crash the server — serve 404. There
      // is no host, so there are no cascade roots: the emergency fallback applies.
      log(c.req.method, "-", pathname, 404);
      return notFound(c, [], pathname);
    }

    // The ordered cascade of domain roots this request walks (§3.1): exact host
    // → wildcard → default → the shipped example default.
    const roots = domainSearchRoots(host, config);
    // Per-domain config.json overrides for this request (§4), merged down the
    // cascade (most-specific root wins). Read per request; missing/malformed
    // files degrade to global defaults.
    const eff = effectiveConfig(config, loadDomainConfigCascade(roots));
    // First root with a non-404 result wins (file, redirect, or short-circuit).
    const result = resolveInRoots(roots, pathname, eff);

    switch (result.kind) {
      case "redirect": {
        const location = result.location + url.search;
        log(c.req.method, host, pathname, 301);
        return c.redirect(location, 301);
      }
      case "file": {
        // Thread the request slice renderers need for content negotiation
        // (§3.3: `.opml` raw-OPML via Accept header or ?format=opml) and the
        // cascade roots so `.md`/`.opml` pick up `_templates/*.eta` overrides.
        const res = await serveFile(
          result.path,
          eff,
          {
            accept: c.req.header("accept"),
            format: url.searchParams.get("format") ?? undefined,
          },
          roots,
        );
        log(c.req.method, host, pathname, res.status);
        return res;
      }
      case "notFound":
      default: {
        log(c.req.method, host, pathname, 404);
        return notFound(c, roots, pathname);
      }
    }
  });

  return app;
}

/**
 * Render the 404 page via the template cascade: the source of the first
 * `_templates/404.eta` found across `roots`, or the embedded
 * {@link NOT_FOUND_FALLBACK} when none supply one (or when there are no roots,
 * e.g. the no-host early path). `path` names the missing resource in the page.
 */
function notFound(c: Context, roots: string[], path: string): Response {
  const source = loadTemplateSource(roots, "404") ?? NOT_FOUND_FALLBACK;
  return c.html(renderTemplate(source, { path }), 404);
}

/** Basic stdout request logging: method, host, path, status. */
function log(method: string, host: string, path: string, status: number): void {
  console.log(`${method} ${host} ${path} ${status}`);
}
