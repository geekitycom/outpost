import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  escapeHtml,
  loadTemplateSource,
  renderTemplate,
} from "../src/render/templates.js";

const fixtures = resolve(__dirname, "fixtures/domains");
const repoRoot = resolve(__dirname, "..");

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe(
      "&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Hello, world")).toBe("Hello, world");
  });
});

describe("renderTemplate", () => {
  it("HTML-escapes <%= it.x %> and emits <%~ it.x %> raw", () => {
    const out = renderTemplate("<h1><%= it.title %></h1><div><%~ it.body %></div>", {
      title: "<b>Hi</b>",
      body: "<p>x</p>",
    });
    expect(out).toBe("<h1>&lt;b&gt;Hi&lt;/b&gt;</h1><div><p>x</p></div>");
  });
});

describe("loadTemplateSource", () => {
  it("returns an earlier root's override, shadowing a later root", () => {
    const src = loadTemplateSource(
      [resolve(fixtures, "tmpl-domain"), resolve(fixtures, "tmpl-fallback")],
      "markdown",
    );
    expect(src).toContain('data-source="tmpl-domain"');
    expect(src).not.toContain('data-source="tmpl-fallback"');
  });

  it("falls through to a later root when the earlier one lacks the template", () => {
    const src = loadTemplateSource(
      [resolve(fixtures, "example.com"), resolve(fixtures, "tmpl-fallback")],
      "markdown",
    );
    expect(src).toContain('data-source="tmpl-fallback"');
  });

  it("returns undefined when no root has the template", () => {
    expect(
      loadTemplateSource([resolve(fixtures, "example.com")], "markdown"),
    ).toBeUndefined();
  });

  it("returns undefined for empty roots", () => {
    expect(loadTemplateSource([], "markdown")).toBeUndefined();
  });
});

describe("shipped default templates are self-contained", () => {
  const sampleFor = {
    markdown: { title: "Title", body: "<h1>Title</h1><p>hi</p>" },
    opml: {
      title: "Title",
      header: "Title",
      meta: '<p class="opml-meta">Last modified: now</p>',
      body: '<ul class="outline"><li class="leaf">node</li></ul>',
    },
  };

  for (const name of ["markdown", "opml"] as const) {
    it(`${name}.eta renders with no external assets or scripts`, () => {
      const source = readFileSync(
        resolve(repoRoot, `domains.example/default/_templates/${name}.eta`),
        "utf8",
      );
      const html = renderTemplate(source, sampleFor[name]);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/s3\.amazonaws/);
      expect(html).not.toMatch(/scripting\.com/);
      expect(html).not.toMatch(/fonts\.googleapis/);
      expect(html).not.toMatch(/jquery/i);
      expect(html).not.toMatch(/bootstrap/i);
      expect(html).not.toMatch(/fargo/i);
      expect(html).not.toMatch(/<script/i);
      expect(html).toContain("<title>Title</title>");
    });
  }
});
