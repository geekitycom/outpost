import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { renderOpmlPage } from "../src/render/opml.js";

const wrap = (head: string, body: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>\n<opml version="2.0">\n<head>${head}</head>\n<body>${body}</body>\n</opml>`;

describe("renderOpmlPage title", () => {
  it("uses the head <title> as the page title", () => {
    const html = renderOpmlPage(
      wrap("<title>My Outline</title>", '<outline text="a"/>'),
      "fallback",
    );
    expect(html).toMatch(/<title>My Outline<\/title>/);
  });

  it("falls back to the given name when there is no head title", () => {
    const html = renderOpmlPage(wrap("", '<outline text="a"/>'), "notes");
    expect(html).toMatch(/<title>notes<\/title>/);
  });

  it("escapes HTML in the title (XSS sanity)", () => {
    const html = renderOpmlPage(
      wrap("<title>&lt;script&gt;x&lt;/script&gt;</title>", '<outline text="a"/>'),
      "fb",
    );
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<title><script>");
  });
});

describe("renderOpmlPage outline structure", () => {
  it("renders a single top-level outline (object, not array)", () => {
    const html = renderOpmlPage(wrap("", '<outline text="Only one"/>'), "fb");
    expect(html).toContain("Only one");
  });

  it("renders multiple top-level outlines (array)", () => {
    const html = renderOpmlPage(
      wrap("", '<outline text="first"/><outline text="second"/>'),
      "fb",
    );
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  it("renders nested outlines recursively across multiple levels", () => {
    const body =
      '<outline text="level1"><outline text="level2"><outline text="level3"/></outline></outline>';
    const html = renderOpmlPage(wrap("", body), "fb");
    expect(html).toContain("level1");
    expect(html).toContain("level2");
    expect(html).toContain("level3");
    // A node with children is collapsible via <details>/<summary> (zero JS).
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
  });

});

describe("renderOpmlPage outline text is Markdown", () => {
  it("renders a Markdown heading as an inline heading label", () => {
    const html = renderOpmlPage(wrap("", '<outline text="## Section"/>'), "fb");
    expect(html).toContain("<h2>Section</h2>");
    expect(html).not.toContain("## Section");
  });

  it("renders plain prose inline, with no <p> wrapper to break the row", () => {
    const html = renderOpmlPage(wrap("", '<outline text="Just some prose."/>'), "fb");
    expect(html).toContain('<li class="leaf">Just some prose.</li>');
    expect(html).not.toContain("<p>Just some prose.</p>");
  });

  it("renders a Markdown link in outline text", () => {
    const html = renderOpmlPage(
      wrap("", '<outline text="see [here](https://ex.com/y)"/>'),
      "fb",
    );
    expect(html).toContain('<a href="https://ex.com/y">here</a>');
  });

  it("passes owner-authored raw HTML links through (OPML is trusted like .md)", () => {
    // The XML parser decodes the entities to a real <a> tag before Markdown runs.
    const html = renderOpmlPage(
      wrap(
        "",
        '<outline text="see &lt;a href=&quot;https://ex.com/x&quot;&gt;here&lt;/a&gt;"/>',
      ),
      "fb",
    );
    expect(html).toContain('<a href="https://ex.com/x">here</a>');
  });
});

describe("renderOpmlPage link handling", () => {
  it('renders type="link" with url as an anchor', () => {
    const html = renderOpmlPage(
      wrap("", '<outline text="A site" type="link" url="https://example.com/x"/>'),
      "fb",
    );
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain("A site");
  });

  it('renders type="rss" with xmlUrl as a feed anchor', () => {
    const html = renderOpmlPage(
      wrap(
        "",
        '<outline text="A feed" type="rss" xmlUrl="https://example.com/feed.xml"/>',
      ),
      "fb",
    );
    expect(html).toContain('href="https://example.com/feed.xml"');
    expect(html).toContain("A feed");
  });

  it("escapes an href to prevent attribute-breakout", () => {
    const html = renderOpmlPage(
      wrap("", '<outline text="x" type="link" url="&quot;&gt;&lt;script&gt;"/>'),
      "fb",
    );
    expect(html).not.toContain('"><script>');
  });
});

describe("renderOpmlPage is self-contained", () => {
  it("emits no external asset/script/style references", () => {
    const html = renderOpmlPage(
      wrap("<title>Doc</title>", '<outline text="plain node"/>'),
      "fb",
    );
    // No external assets (a legit hyperlink from OPML data would be fine, but
    // this fixture has none, so nothing http(s) should appear at all).
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/s3\.amazonaws\.com/);
    expect(html).not.toMatch(/scripting\.com/);
    expect(html).not.toMatch(/fonts\.googleapis/);
    expect(html).not.toMatch(/jquery/i);
    expect(html).not.toMatch(/bootstrap/i);
    expect(html).not.toMatch(/fargo/i);
    expect(html).not.toMatch(/<script/i);
  });
});

describe("renderOpmlPage real-world sample", () => {
  it("renders Dave Winer's source.opml without crashing", () => {
    const source = readFileSync(
      resolve(__dirname, "fixtures/domains/example.com/source.opml"),
      "utf8",
    );
    const html = renderOpmlPage(source, "source");
    expect(html).toContain("<title>nodeEditor: pagePark</title>");
    expect(html).toContain("<details");
    // The deep nested outline produced real list items.
    expect(html.match(/<li/g)!.length).toBeGreaterThan(50);
  });
});

describe("renderOpmlPage malformed input", () => {
  it("throws on malformed XML (caller turns this into a 500)", () => {
    expect(() =>
      renderOpmlPage("<opml><head><title>Broken</head><body>", "fb"),
    ).toThrow();
  });
});
