import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { marked } from "marked";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { EffectiveConfig } from "../domainConfig.js";
import type { ServeRequest } from "../serve.js";
import {
  escapeHtml,
  loadTemplateSource,
  OPML_FALLBACK,
  renderTemplate,
} from "./templates.js";

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
  roots: string[] = [],
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
    const template = loadTemplateSource(roots, "opml") ?? OPML_FALLBACK;
    const html = renderOpmlPage(
      source,
      fallbackTitle,
      template,
      roots,
      basename(filePath),
    );
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
 * elements become a collapsible nested list, wrapped in the given `template`
 * (the embedded fallback by default). Throws on malformed XML so the
 * `renderOpml` wrapper can return a 500 rather than crash.
 *
 * `fileName` is the served file's base name (e.g. `index.opml`); it becomes the
 * relative `?format=opml` href the page advertises (via `<link rel="alternate">`
 * and the XML badge). Naming the file explicitly — rather than a bare
 * `?format=opml` — keeps the link correct for an index served at a directory URL
 * (`/` → `index.opml?format=opml`) so a raw download lands with the right name.
 */
export function renderOpmlPage(
  source: string,
  fallbackTitle: string,
  template: string = OPML_FALLBACK,
  roots: string[] = [],
  fileName: string = "",
): string {
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

  // Relative href to the raw OPML. Encode the file name so a space or other
  // reserved character stays a valid path segment; the template `<%= %>` then
  // HTML-escapes it into the attribute. Falls back to a bare query (resolves
  // against the current URL) when no file name is supplied (direct callers).
  const opmlHref = fileName
    ? `${encodeURIComponent(fileName)}?format=opml`
    : "?format=opml";

  return renderTemplate(
    template,
    {
      // Raw title/header: the template's `<%= %>` escapes them. `meta`/`body`
      // are already-built HTML fragments and pass through raw via `<%~ %>`.
      title: pageTitle,
      header: pageTitle,
      meta,
      body: `<ul class="outline">${outlineHtml}</ul>`,
      opmlHref,
    },
    roots,
  );
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

/**
 * Render one `<outline>` headline (and its subs, recursively) to an `<li>`.
 *
 * Three optional attributes on a headline with subs (Fargo/Drummer conventions)
 * shape how the subs display:
 *   - `flBulletedSubs` — show a bullet beside each sub.
 *   - `flNumberedSubs` — number the subs in sequence (renders an `<ol>`).
 *   - `collapse` — start the subs collapsed instead of expanded.
 */
function renderOutline(outline: Record<string, unknown>): string {
  const label = renderLabel(outline);
  const childHtml = renderOutlines(outline["outline"]);

  if (childHtml.length > 0) {
    const open = attrFlag(outline, "collapse") ? "" : " open";
    const numbered = attrFlag(outline, "flNumberedSubs");
    const bulleted = attrFlag(outline, "flBulletedSubs");
    // Numbering needs an <ol> for sequence; bullets stay a <ul> with a marker.
    const tag = numbered ? "ol" : "ul";
    const cls = numbered
      ? ' class="subs-numbered"'
      : bulleted
        ? ' class="subs-bulleted"'
        : "";
    return `<li><details${open}><summary>${label}</summary><${tag}${cls}>${childHtml}</${tag}></details></li>`;
  }
  return `<li class="leaf">${label}</li>`;
}

/**
 * The visible label for an outline node: an anchor for type "link" (url) or
 * type "rss" (xmlUrl/url), otherwise the text rendered as inline Markdown.
 *
 * Feed/link titles are escaped (they are plain labels, and rendering them as
 * Markdown could nest anchors inside the generated anchor), so a hostile url
 * cannot break out of the attribute. The href is always escaped.
 */
function renderLabel(outline: Record<string, unknown>): string {
  const text = coerceText(attr(outline, "text")) ?? "";
  const type = coerceText(attr(outline, "type"))?.toLowerCase();

  if (type === "link") {
    const url = coerceText(attr(outline, "url"));
    if (url) return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
  }

  if (type === "rss") {
    const url = coerceText(attr(outline, "xmlUrl")) ?? coerceText(attr(outline, "url"));
    if (url) {
      return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a><span class="rss-tag">RSS</span>`;
    }
  }

  return renderOutlineText(text);
}

/**
 * Render an outline's text as Markdown for use as a label. OPML files live in
 * the domain owner's folder, so their text is trusted the same way a Markdown
 * page is: inline Markdown, "## " headings, and raw HTML (e.g. anchor links)
 * all pass through. See the domains index.opml samples.
 *
 * A single enclosing paragraph tag is unwrapped so plain prose sits inline
 * inside the summary/li label; Markdown's default block wrapping would
 * otherwise push a paragraph into every outline row and break the layout.
 * Genuine block output (headings, lists) is preserved and styled by the template.
 */
function renderOutlineText(text: string): string {
  const html = marked.parse(text, { async: false }).trim();
  if (html.startsWith("<p>") && html.endsWith("</p>")) {
    const inner = html.slice(3, -4);
    // Unwrap only a lone paragraph: if inner still holds a paragraph tag, the
    // source was multi-block (several paragraphs) and must keep its wrappers.
    if (!inner.includes("<p>") && !inner.includes("<p ")) return inner;
  }
  return html;
}

/** Read a prefixed attribute value off a parsed element. */
function attr(outline: Record<string, unknown>, name: string): unknown {
  return outline[`${ATTR_PREFIX}${name}`];
}

/**
 * Read a boolean-ish outline attribute. OPML flags are conventionally the
 * string "true" (fast-xml-parser may also hand back a real boolean), so treat
 * true/1/yes as set and everything else (including absent) as unset.
 */
function attrFlag(outline: Record<string, unknown>, name: string): boolean {
  const value = coerceText(attr(outline, name))?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
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
