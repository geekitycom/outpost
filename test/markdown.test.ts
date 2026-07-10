import { describe, it, expect } from "vitest";
import { renderMarkdownPage } from "../src/render/markdown.js";

describe("renderMarkdownPage title", () => {
  it("uses the first H1 as the page title", () => {
    const html = renderMarkdownPage("# Hello World\n\nbody", "fallback");
    expect(html).toMatch(/<title>Hello World<\/title>/);
  });

  it("falls back to the given name when there is no H1", () => {
    const html = renderMarkdownPage("## Only an H2\n\nbody", "notes");
    expect(html).toMatch(/<title>notes<\/title>/);
  });

  it("prefers the first H1 even when a lower heading precedes it", () => {
    const html = renderMarkdownPage("## sub\n\n# Real Title\n", "fallback");
    expect(html).toMatch(/<title>Real Title<\/title>/);
  });

  it("escapes HTML in the title (XSS sanity)", () => {
    const html = renderMarkdownPage("# <script>alert(1)</script>\n", "fb");
    expect(html).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(html).not.toContain("<title><script>");
  });
});

describe("renderMarkdownPage body", () => {
  it("renders headings, emphasis, links, lists and code", () => {
    const md = [
      "# Title",
      "",
      "A **bold** and *italic* word with `inline` code.",
      "",
      "[a link](https://example.com/page)",
      "",
      "- one",
      "- two",
      "",
      "```",
      "block code",
      "```",
    ].join("\n");
    const html = renderMarkdownPage(md, "fb");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain('<a href="https://example.com/page">a link</a>');
    expect(html).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    expect(html).toContain("<pre><code>block code");
  });
});

describe("renderMarkdownPage is self-contained", () => {
  it("emits no external asset references", () => {
    const html = renderMarkdownPage("# Doc\n\ntext", "fb");
    // Guard against regressions to CDN / Dave assets.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\/\/s3\.amazonaws\.com/);
    expect(html).not.toMatch(/fonts\.googleapis/);
    expect(html).not.toMatch(/jquery/i);
    expect(html).not.toMatch(/bootstrap/i);
    expect(html).not.toMatch(/fargo/i);
    expect(html).not.toMatch(/<script/i);
  });
});
