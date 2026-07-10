/**
 * Default page templates and token substitution for the self-contained
 * renderers (Markdown now; OPML and a 404 page slot in alongside later).
 *
 * Templates are plain strings with `[%token%]` placeholders. `renderTemplate`
 * fills them in. Values that land inside HTML text/attributes must be run
 * through `escapeHtml` by the caller first — the substitution itself is literal
 * so that already-rendered HTML (e.g. a Markdown body) passes through intact.
 */

/** Escape the five HTML-significant characters for safe interpolation. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replace every `[%token%]` in `template` with `tokens[token]`. Unknown tokens
 * are left untouched so a typo is visible rather than silently blanking output.
 */
export function renderTemplate(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(/\[%(\w+)%\]/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name]! : match,
  );
}

/**
 * Self-contained Markdown page template. Tokens: `title` (escaped by the
 * caller) and `body` (already-rendered HTML). All styling is inline — no CDN,
 * no fonts, no scripts, no external assets of any kind (§5). The CSS is a small
 * hand-written GitHub-ish reading style using only system font stacks.
 */
export const MARKDOWN_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>[%title%]</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: #1f2328;
  background: #ffffff;
  margin: 0;
  padding: 2rem 1rem;
}
main {
  max-width: 46rem;
  margin: 0 auto;
  word-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.5em 0 0.5em; font-weight: 600; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
ul, ol { padding-left: 2em; }
li + li { margin-top: 0.25em; }
blockquote {
  margin-left: 0;
  padding: 0 1em;
  color: #59636e;
  border-left: 0.25em solid #d1d9e0;
}
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: rgba(129, 139, 152, 0.12);
  padding: 0.2em 0.4em;
  border-radius: 6px;
}
pre {
  background: #f6f8fa;
  padding: 1em;
  border-radius: 6px;
  overflow: auto;
}
pre code { background: none; padding: 0; font-size: 0.85em; }
table { border-collapse: collapse; display: block; overflow: auto; }
th, td { padding: 0.4em 0.8em; border: 1px solid #d1d9e0; }
th { background: #f6f8fa; }
img { max-width: 100%; }
hr { height: 1px; border: 0; background: #d1d9e0; margin: 1.5em 0; }
@media (prefers-color-scheme: dark) {
  body { color: #e6edf3; background: #0d1117; }
  h1, h2 { border-bottom-color: #3d444d; }
  a { color: #4493f8; }
  blockquote { color: #9198a1; border-left-color: #3d444d; }
  code { background: rgba(101, 108, 118, 0.2); }
  pre { background: #151b23; }
  th, td { border-color: #3d444d; }
  th { background: #151b23; }
  hr { background: #3d444d; }
}
</style>
</head>
<body>
<main>
[%body%]
</main>
</body>
</html>
`;

/**
 * Self-contained OPML outline page template. Tokens: `title` and `header`
 * (escaped by the caller) and `body` (already-rendered outline HTML).
 *
 * The outline collapses/expands with native `<details>`/`<summary>` — zero
 * JavaScript, so there is no `<script>` and nothing external to load. All
 * styling is inline hand-written CSS using only system fonts (§5). No CDN,
 * no scripting.com, no Dave/Fargo assets, no frameworks.
 */
export const OPML_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>[%title%]</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  color: #1f2328;
  background: #ffffff;
  margin: 0;
  padding: 2rem 1rem;
}
main { max-width: 52rem; margin: 0 auto; word-wrap: break-word; }
header { margin: 0 0 1.5rem; }
h1 { font-size: 1.75em; line-height: 1.25; margin: 0 0 0.25rem; font-weight: 600; }
.opml-meta { color: #59636e; font-size: 0.9em; margin: 0; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
ul.outline, ul.outline ul { list-style: none; margin: 0; padding: 0; }
ul.outline ul { padding-left: 1.25em; border-left: 1px solid #d1d9e0; margin-left: 0.4em; }
ul.outline li { margin: 0.15em 0; }
/* Markdown in an outline label renders inline: headings become bold labels
   (no block margins/border) so they sit beside the summary triangle, and a
   stray paragraph never adds vertical gaps to a row. */
ul.outline :is(h1, h2, h3, h4, h5, h6) {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 1em;
  font-weight: 700;
  line-height: inherit;
}
ul.outline li p { display: inline; margin: 0; }
details > summary {
  cursor: pointer;
  list-style: none;
  padding: 0.1em 0;
}
details > summary::-webkit-details-marker { display: none; }
details > summary::before {
  content: "\\25B8";
  display: inline-block;
  width: 1em;
  color: #59636e;
  transition: transform 0.1s ease;
}
details[open] > summary::before { transform: rotate(90deg); }
li.leaf { padding-left: 1em; }
.rss-tag {
  font-size: 0.7em;
  color: #59636e;
  border: 1px solid #d1d9e0;
  border-radius: 4px;
  padding: 0 0.3em;
  margin-left: 0.4em;
  vertical-align: middle;
}
@media (prefers-color-scheme: dark) {
  body { color: #e6edf3; background: #0d1117; }
  .opml-meta, details > summary::before, .rss-tag { color: #9198a1; }
  a { color: #4493f8; }
  ul.outline ul { border-left-color: #3d444d; }
  .rss-tag { border-color: #3d444d; }
}
</style>
</head>
<body>
<main>
<header>
<h1>[%header%]</h1>
[%meta%]
</header>
[%body%]
</main>
</body>
</html>
`;
