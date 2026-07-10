import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { extname } from "node:path";
import type { EffectiveConfig } from "./domainConfig.js";
import { contentTypeForExtension } from "./mime.js";
import { renderMarkdown } from "./render/markdown.js";
import { renderOpml } from "./render/opml.js";

/**
 * The slice of request info that renderers need for content negotiation
 * (§3.3): the `Accept` header and the `?format` query value. Kept tiny and
 * framework-agnostic so `serveFile` doesn't depend on Hono and tests can call
 * it directly. The caller (app.ts) fills it from the Hono context.
 */
export interface ServeRequest {
  /** Raw `Accept` header value, if any. */
  accept?: string | undefined;
  /** Value of the `?format=` query parameter, if any. */
  format?: string | undefined;
}

/**
 * Read a resolved file and return a web `Response` with the right Content-Type.
 *
 * Dispatch by extension so renderers slot in without the caller caring: `.md`
 * and `.opml` parse and wrap their content in a self-contained HTML template;
 * `.opml` also honors raw-OPML content negotiation (needs `request`). Every
 * other extension is served as-is with a MIME derived from the extension. `.js`
 * is served as static `text/javascript`, never executed.
 *
 * Files are buffered fully (fine for the MVP; streaming large binaries is a §11
 * nice-to-have).
 *
 * `roots` are the resolution roots threaded to the `.md`/`.opml` renderers so
 * they can pick up a domain's `_templates/*.eta` overrides.
 */
export async function serveFile(
  filePath: string,
  config: EffectiveConfig,
  request: ServeRequest = {},
  roots: string[] = [],
): Promise<Response> {
  const ext = effectiveExtension(filePath, config);

  switch (ext) {
    case ".md":
      return renderMarkdown(filePath, config, roots);
    case ".opml":
      return renderOpml(filePath, config, request, roots);
    default:
      return serveStatic(filePath, config, ext);
  }
}

/**
 * The extension used for dispatch/MIME. Normally the file's own extension; but
 * when the file has none and the domain sets `defaultExtension` (§4), it is
 * treated as if it carried `.<defaultExtension>` (so e.g. an extension-less file
 * renders as Markdown/OPML). Precedence: a real extension always wins;
 * `defaultExtension` only applies to genuinely extension-less files.
 */
function effectiveExtension(filePath: string, config: EffectiveConfig): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === "" && config.defaultExtension) {
    return `.${config.defaultExtension}`;
  }
  return ext;
}

/**
 * How long browsers may cache a non-HTML static asset (in seconds). One hour is
 * long enough to spare repeat requests for CSS/favicons/images yet short enough
 * that edits show up soon after.
 */
const STATIC_MAX_AGE_SECONDS = 3600;

/** Serve a file's raw bytes with a Content-Type derived from `ext`. */
async function serveStatic(
  filePath: string,
  config: EffectiveConfig,
  ext: string,
): Promise<Response> {
  const data = await readFile(filePath);
  const contentType = contentTypeForExtension(ext, config.defaultType);
  // Copy into a fresh ArrayBuffer-backed view so the Response body is a clean
  // Uint8Array regardless of Node Buffer pooling.
  const body = new Uint8Array(data);
  const headers: Record<string, string> = { "content-type": contentType };
  // Cache non-HTML assets (CSS, favicons, images, JS): they're externalized so
  // browsers can reuse them across page loads. HTML stays uncached so in-place
  // edits to pages are served fresh.
  if (!contentType.startsWith("text/html")) {
    headers["cache-control"] = `public, max-age=${STATIC_MAX_AGE_SECONDS}`;
    headers["last-modified"] = statSync(filePath).mtime.toUTCString();
  }
  return new Response(body, {
    status: 200,
    headers,
  });
}
