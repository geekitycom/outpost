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

describe("shipped default templates render via the layout", () => {
  // The shipped templates call `layout("layout")`, so they must render with the
  // domain root as a cascade root for the bare `layout` name to resolve.
  const defaultRoot = resolve(repoRoot, "domains.example/default");

  const cases = {
    markdown: {
      data: { title: "Title", body: "<h1>Title</h1><p>hi</p>" },
      stylesheet: "markdown",
      title: "Title",
      bodyText: "<h1>Title</h1>",
    },
    opml: {
      data: {
        title: "Title",
        header: "Title",
        meta: '<p class="opml-meta">Last modified: now</p>',
        body: '<ul class="outline"><li class="leaf">node</li></ul>',
        opmlHref: "index.opml?format=opml",
      },
      stylesheet: "opml",
      title: "Title",
      bodyText: '<li class="leaf">node</li>',
    },
    "404": {
      data: { path: "/missing.html" },
      stylesheet: "404",
      // The layout's title comes from the child template's own layout data.
      title: "404 Not Found",
      bodyText: "<h1>404</h1>",
    },
  } as const;

  for (const name of ["markdown", "opml", "404"] as const) {
    const c = cases[name];

    it(`${name}.eta emits the base and page stylesheet links`, () => {
      const html = render(name, c.data);
      expect(html).toContain('<link rel="stylesheet" href="/css/base.css">');
      expect(html).toContain(
        `<link rel="stylesheet" href="/css/${c.stylesheet}.css">`,
      );
    });

    it(`${name}.eta emits the favicon and manifest links`, () => {
      const html = render(name, c.data);
      expect(html).toContain('href="/favicon-32x32.png"');
      expect(html).toContain('href="/site.webmanifest"');
    });

    it(`${name}.eta stays self-contained (no external assets or scripts)`, () => {
      const html = render(name, c.data);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/s3\.amazonaws/);
      expect(html).not.toMatch(/scripting\.com/);
      expect(html).not.toMatch(/fonts\.googleapis/);
      expect(html).not.toMatch(/jquery/i);
      expect(html).not.toMatch(/bootstrap/i);
      expect(html).not.toMatch(/fargo/i);
      expect(html).not.toMatch(/<script/i);
    });

    it(`${name}.eta carries the title and rendered body`, () => {
      const html = render(name, c.data);
      expect(html).toContain(`<title>${c.title}</title>`);
      expect(html).toContain(c.bodyText);
    });
  }

  it("opml.eta advertises the raw OPML via the alternate link and XML badge", () => {
    const html = render("opml", cases.opml.data);
    expect(html).toContain(
      '<link rel="alternate" type="text/x-opml" href="index.opml?format=opml" title="OPML">',
    );
    expect(html).toContain(
      '<a class="opml-badge" href="index.opml?format=opml"><img src="/img/xml.gif"',
    );
  });

  it("markdown.eta omits the OPML alternate link", () => {
    const html = render("markdown", cases.markdown.data);
    expect(html).not.toContain('rel="alternate"');
  });

  /** Render a shipped template by name against the default domain root. */
  function render(name: string, data: Record<string, unknown>): string {
    const source = readFileSync(
      resolve(defaultRoot, `_templates/${name}.eta`),
      "utf8",
    );
    return renderTemplate(source, data, [defaultRoot]);
  }
});
