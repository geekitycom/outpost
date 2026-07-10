import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { EffectiveConfig } from "../domainConfig.js";
import type { ServeRequest } from "../serve.js";
import { escapeHtml, OPML_TEMPLATE, renderTemplate } from "./templates.js";

/** Attribute prefix so parsed attributes are explicit and can't collide with child element names. */
const ATTR_PREFIX = "@_";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  // Keep declared entities decoded (&amp; etc.) so text/urls are real values.
  processEntities: true,
});

/**
 * Render a `.opml` file to a `Response`, per §3.3 / §5.1.
 *
 * Content negotiation exception: when the request asks for raw OPML (either
 * `Accept: text/x-opml` or `?format=opml`), the untouched bytes are returned as
 * `text/x-opml` instead of the rendered page. Otherwise the outline is rendered
 * to a self-contained collapsible HTML page (`text/html`).
 *
 * Malformed OPML never crashes the server: parse failures are caught and turned
 * into a plain-text HTTP 500 (Dave had repeated crash bugs here).
 */
export async function renderOpml(
  filePath: string,
  config: EffectiveConfig,
  request: ServeRequest = {},
): Promise<Response> {
  const source = await readFile(filePath, "utf8");

  if (wantsRawOpml(request)) {
    return new Response(source, {
      status: 200,
      headers: { "content-type": "text/x-opml; charset=utf-8" },
    });
  }

  try {
    // A per-domain siteTitle (§4) overrides the file-name fallback used when the
    // outline's <head> has no <title> of its own.
    const fallbackTitle =
      config.siteTitle ?? basename(filePath, extname(filePath));
    const html = renderOpmlPage(source, fallbackTitle);
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return new Response("500 Internal Server Error: could not parse OPML\n", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

/** True when the client asked for the raw OPML bytes rather than rendered HTML. */
function wantsRawOpml(request: ServeRequest): boolean {
  if (request.format?.toLowerCase() === "opml") return true;
  const accept = request.accept?.toLowerCase() ?? "";
  return accept.includes("text/x-opml");
}

/**
 * Turn OPML source into a complete, self-contained HTML page string.
 *
 * The page `<title>`/header is the `<head><title>`, falling back to
 * `fallbackTitle` (the file's base name). The `<body>`'s nested `<outline>`
 * elements become a collapsible nested list. Throws on malformed XML so the
 * `renderOpml` wrapper can return a 500 rather than crash.
 */
export function renderOpmlPage(source: string, fallbackTitle: string): string {
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    throw new Error(
      `Malformed OPML: ${validation.err.msg} (line ${validation.err.line})`,
    );
  }

  const parsed = parser.parse(source) as Record<string, unknown>;
  const opml = asObject(parsed["opml"]);
  if (opml === undefined) {
    throw new Error("Malformed OPML: missing <opml> root element");
  }

  const head = asObject(opml["head"]);
  const title = coerceText(head?.["title"])?.trim();
  const dateModified = coerceText(head?.["dateModified"])?.trim();
  const pageTitle = title && title.length > 0 ? title : fallbackTitle;

  const body = asObject(opml["body"]);
  const outlineHtml = renderOutlines(body?.["outline"]);

  const meta =
    dateModified && dateModified.length > 0
      ? `<p class="opml-meta">Last modified: ${escapeHtml(dateModified)}</p>`
      : "";

  return renderTemplate(OPML_TEMPLATE, {
    title: escapeHtml(pageTitle),
    header: escapeHtml(pageTitle),
    meta,
    body: `<ul class="outline">${outlineHtml}</ul>`,
  });
}

/**
 * Render zero or more `<outline>` elements to `<li>` items. fast-xml-parser
 * yields an object for a single child and an array for several, so both are
 * normalized here.
 */
function renderOutlines(node: unknown): string {
  return toArray(node)
    .map(asObject)
    .filter((o): o is Record<string, unknown> => o !== undefined)
    .map(renderOutline)
    .join("");
}

/** Render one `<outline>` node (and its children, recursively) to an `<li>`. */
function renderOutline(outline: Record<string, unknown>): string {
  const label = renderLabel(outline);
  const childHtml = renderOutlines(outline["outline"]);

  if (childHtml.length > 0) {
    return `<li><details open><summary>${label}</summary><ul>${childHtml}</ul></details></li>`;
  }
  return `<li class="leaf">${label}</li>`;
}

/**
 * The visible label for an outline node: an anchor for `type="link"` (url) or
 * `type="rss"` (xmlUrl/url), otherwise escaped text. Everything interpolated is
 * escaped, so hostile `text`/`url` attributes can't break out of the markup.
 */
function renderLabel(outline: Record<string, unknown>): string {
  const text = coerceText(attr(outline, "text")) ?? "";
  const safeText = escapeHtml(text);
  const type = coerceText(attr(outline, "type"))?.toLowerCase();

  if (type === "link") {
    const url = coerceText(attr(outline, "url"));
    if (url) return `<a href="${escapeHtml(url)}">${safeText}</a>`;
  }

  if (type === "rss") {
    const url = coerceText(attr(outline, "xmlUrl")) ?? coerceText(attr(outline, "url"));
    if (url) {
      return `<a href="${escapeHtml(url)}">${safeText}</a><span class="rss-tag">RSS</span>`;
    }
  }

  return safeText;
}

/** Read a prefixed attribute value off a parsed element. */
function attr(outline: Record<string, unknown>, name: string): unknown {
  return outline[`${ATTR_PREFIX}${name}`];
}

/** Wrap a single value in an array, pass arrays through, drop null/undefined. */
function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Narrow to a plain object, or `undefined` for anything else. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Coerce a parsed attribute/element value to text. fast-xml-parser may yield a
 * string, a number/boolean (e.g. a numeric-looking title), or `undefined`.
 */
function coerceText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
