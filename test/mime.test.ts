import { describe, it, expect } from "vitest";
import { contentTypeFor } from "../src/mime.js";

const defaultType = "text/html";

describe("contentTypeFor", () => {
  it("maps .html to text/html", () => {
    expect(contentTypeFor("index.html", defaultType)).toMatch(/^text\/html/);
  });

  it("maps image extensions correctly", () => {
    expect(contentTypeFor("logo.png", defaultType)).toBe("image/png");
    expect(contentTypeFor("photo.jpg", defaultType)).toBe("image/jpeg");
    expect(contentTypeFor("anim.gif", defaultType)).toBe("image/gif");
  });

  it("serves .js as text/javascript (static, never executed)", () => {
    expect(contentTypeFor("app.js", defaultType)).toMatch(/javascript/);
  });

  it("uses the configured default type for extension-less files", () => {
    expect(contentTypeFor("README", defaultType)).toBe("text/html");
  });

  it("uses the configured default type for unknown extensions", () => {
    expect(contentTypeFor("data.weirdext", defaultType)).toBe("text/html");
  });
});
