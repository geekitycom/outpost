/**
 * Page templating for the self-contained renderers (Markdown, OPML, and the
 * 404 page).
 *
 * Templates are [Eta](https://eta.js.org) sources: `<%= it.x %>` HTML-escapes a
 * value, `<%~ it.x %>` emits it raw. The real, styled templates live as `.eta`
 * files under a domain's `_templates/` folder and are loaded via
 * `loadTemplateSource`, cascading across the resolution roots. The `*_FALLBACK`
 * consts below are the emergency defaults used when no root supplies one.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Eta } from "eta";

/** Escape the five HTML-significant characters for safe interpolation. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared Eta instance; templates are trusted strings, so defaults are fine. */
const eta = new Eta();

// Resolve a bare template name used by `layout(...)`/`include(...)` against the
// current request's cascade roots (threaded in per-render via `withConfig`),
// so an override in an earlier root shadows a later one — the same order
// `loadTemplateSource` walks. Eta's default `readFile` then reads the absolute
// path returned here.
eta.resolvePath = function (name) {
  const roots =
    (this.config as unknown as { cascadeRoots?: string[] }).cascadeRoots ?? [];
  const file = name.endsWith(".eta") ? name : `${name}.eta`;
  for (const root of roots) {
    const p = join(root, "_templates", file);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // Not in this root — try the next one.
    }
  }
  throw new Error(`Outpost: template "${name}" not found in any root`);
};

/**
 * Render an Eta template `source` with `data` exposed as `it`. `<%= it.x %>`
 * escapes; `<%~ it.x %>` emits raw HTML, so callers pass raw text for the
 * former and already-built HTML for the latter.
 *
 * `roots` are the request's cascade roots; a template that calls
 * `layout("layout")`/`include(...)` resolves those bare names against them (see
 * `eta.resolvePath`). The standalone `*_FALLBACK` consts call neither and so
 * render fine with the default empty `roots`.
 */
export function renderTemplate(
  source: string,
  data: Record<string, unknown> = {},
  roots: string[] = [],
): string {
  return eta
    .withConfig({ cascadeRoots: roots } as never)
    .renderString(source, data);
}

/**
 * Find a template by `name` (e.g. `"markdown"`) across `roots` in order,
 * returning the source of the first `<root>/_templates/<name>.eta` that reads
 * successfully, or `undefined` if none do. Paths are internal (not user input),
 * so a missing file is expected and simply falls through to the next root.
 */
export function loadTemplateSource(
  roots: string[],
  name: string,
): string | undefined {
  for (const root of roots) {
    try {
      return readFileSync(join(root, "_templates", `${name}.eta`), "utf8");
    } catch {
      // Not in this root — try the next one.
    }
  }
  return undefined;
}

/**
 * Emergency Markdown page template used when no `_templates/markdown.eta` is
 * found in any root. Self-contained (inline CSS, no external assets, no
 * scripts). Slots: `title` (escaped) and `body` (already-rendered HTML). The
 * full styled version ships as `domains.example/default/_templates/markdown.eta`.
 */
export const MARKDOWN_FALLBACK = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><%= it.title %></title>
<style>
:root { color-scheme: light dark; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  max-width: 46rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
</style>
</head>
<body>
<main>
<%~ it.body %>
</main>
</body>
</html>
`;

/**
 * Emergency OPML page template used when no `_templates/opml.eta` is found in
 * any root. Self-contained (inline CSS, no external assets, no scripts). Slots:
 * `title`/`header` (escaped) and `meta`/`body` (already-built HTML). The full
 * styled version ships as `domains.example/default/_templates/opml.eta`.
 */
export const OPML_FALLBACK = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><%= it.title %></title>
<link rel="alternate" type="text/x-opml" href="<%= it.opmlHref %>" title="OPML">
<style>
:root { color-scheme: light dark; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
ul.outline, ul.outline ul, ul.outline ol { list-style: none; margin: 0; padding-left: 1.25em; }
.opml-meta { color: #59636e; font-size: 0.9em; }
</style>
</head>
<body>
<main>
<header>
<h1><%= it.header %></h1>
<%~ it.meta %>
</header>
<%~ it.body %>
</main>
</body>
</html>
`;

/**
 * Emergency 404 page template used when no `_templates/404.eta` is found in any
 * root. Self-contained (inline CSS, no external assets, no scripts). The
 * optional `path` slot names the missing resource when the caller supplies it.
 */
export const NOT_FOUND_FALLBACK = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 Not Found</title>
<style>
:root { color-scheme: light dark; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  text-align: center;
  margin: 0 auto;
  padding: 4rem 1rem;
}
h1 { font-size: 4em; margin: 0; color: #59636e; }
</style>
</head>
<body>
<main>
<h1>404</h1>
<p>Not Found</p>
<% if (it.path) { %>
<p><code><%= it.path %></code> could not be found.</p>
<% } %>
</main>
</body>
</html>
`;
