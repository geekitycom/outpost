import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { marked } from "marked";
import type { EffectiveConfig } from "../domainConfig.js";
import { escapeHtml, MARKDOWN_TEMPLATE, renderTemplate } from "./templates.js";

/**
 * Render a `.md` file to a full, self-contained HTML page `Response`
 * (`text/html`), per §3.3 / §5.2. Complexity (title extraction, templating)
 * lives behind this small interface so `serve.ts` just dispatches to it.
 */
export async function renderMarkdown(
  filePath: string,
  config: EffectiveConfig,
): Promise<Response> {
  const source = await readFile(filePath, "utf8");
  // A per-domain siteTitle (§4) overrides the file-name fallback used when the
  // document has no `# H1` of its own.
  const fallbackTitle = config.siteTitle ?? basename(filePath, extname(filePath));
  const html = renderMarkdownPage(source, fallbackTitle);
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Turn Markdown source into a complete HTML page string.
 *
 * The page `<title>` is the first `# H1` heading's text, falling back to
 * `fallbackTitle` (the file's base name) when there is no H1 — mirroring the
 * legacy behavior. The rendered body is wrapped in a self-contained template
 * with inline CSS (no external assets).
 */
export function renderMarkdownPage(
  source: string,
  fallbackTitle: string,
): string {
  const title = extractTitle(source) ?? fallbackTitle;
  const body = marked.parse(source, { async: false });
  return renderTemplate(MARKDOWN_TEMPLATE, {
    title: escapeHtml(title),
    body,
  });
}

/** First `# H1` heading text, or `undefined` if the document has none. */
function extractTitle(source: string): string | undefined {
  for (const token of marked.lexer(source)) {
    if (token.type === "heading" && token.depth === 1) {
      return token.text.trim();
    }
  }
  return undefined;
}
