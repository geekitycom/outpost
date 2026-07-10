import { describe, it, expect } from "vitest";
import { escapeHtml, renderTemplate } from "../src/render/templates.js";

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
  it("substitutes [%token%] placeholders", () => {
    const out = renderTemplate("<h1>[%title%]</h1><div>[%body%]</div>", {
      title: "Hi",
      body: "<p>x</p>",
    });
    expect(out).toBe("<h1>Hi</h1><div><p>x</p></div>");
  });

  it("replaces every occurrence of a token", () => {
    expect(renderTemplate("[%x%]-[%x%]", { x: "z" })).toBe("z-z");
  });

  it("leaves unknown tokens in place", () => {
    expect(renderTemplate("[%unknown%]", {})).toBe("[%unknown%]");
  });
});
