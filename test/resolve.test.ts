import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { resolvePath } from "../src/resolve.js";
import type { Config } from "../src/config.js";

const domainsDir = resolve(__dirname, "fixtures/domains");
const domainFolder = join(domainsDir, "example.com");

const config: Config = {
  port: 3000,
  host: "127.0.0.1",
  domainsDir,
  defaultDomain: "default",
  trustForwardedHeaders: true,
  indexFilename: "index",
  defaultType: "text/html",
};

describe("resolvePath", () => {
  it("serves an existing html file", () => {
    const r = resolvePath(domainFolder, "/page.html", config);
    expect(r).toEqual({ kind: "file", path: join(domainFolder, "page.html") });
  });

  it("serves a static .js file (path only — never executed)", () => {
    const r = resolvePath(domainFolder, "/app.js", config);
    expect(r).toEqual({ kind: "file", path: join(domainFolder, "app.js") });
  });

  it("returns notFound for a missing file", () => {
    expect(resolvePath(domainFolder, "/nope.html", config)).toEqual({
      kind: "notFound",
    });
  });

  it("blocks ../ traversal outside the domain folder", () => {
    expect(resolvePath(domainFolder, "/../default/index.html", config)).toEqual(
      { kind: "notFound" },
    );
  });

  it("blocks encoded ../ traversal", () => {
    expect(
      resolvePath(domainFolder, "/%2e%2e/default/index.html", config),
    ).toEqual({ kind: "notFound" });
  });

  it("rejects segments starting with _ (hidden)", () => {
    expect(resolvePath(domainFolder, "/_hidden/secret.html", config)).toEqual({
      kind: "notFound",
    });
  });

  it("rejects dotfile segments", () => {
    expect(resolvePath(domainFolder, "/.hidden/data.txt", config)).toEqual({
      kind: "notFound",
    });
  });

  it("never serves config.json", () => {
    expect(resolvePath(domainFolder, "/config.json", config)).toEqual({
      kind: "notFound",
    });
  });

  it("redirects a directory without a trailing slash", () => {
    expect(resolvePath(domainFolder, "/sub", config)).toEqual({
      kind: "redirect",
      location: "/sub/",
    });
  });

  it("serves the index file for a directory with a trailing slash", () => {
    expect(resolvePath(domainFolder, "/sub/", config)).toEqual({
      kind: "file",
      path: join(domainFolder, "sub", "index.html"),
    });
  });

  it("serves the root index for /", () => {
    expect(resolvePath(domainFolder, "/", config)).toEqual({
      kind: "file",
      path: join(domainFolder, "index.html"),
    });
  });

  it("returns notFound for a directory without an index", () => {
    expect(resolvePath(domainFolder, "/emptydir/", config)).toEqual({
      kind: "notFound",
    });
  });

  it("returns notFound for malformed percent-encoding", () => {
    expect(resolvePath(domainFolder, "/%ZZ", config)).toEqual({
      kind: "notFound",
    });
  });
});

describe("resolvePath path-security hardening", () => {
  // config.json must never be served, regardless of the case used to request it
  // (case-insensitive filesystems, e.g. macOS/Windows, would otherwise expose it).
  it("never serves config.json requested with a different case", () => {
    expect(resolvePath(domainFolder, "/Config.json", config)).toEqual({
      kind: "notFound",
    });
    expect(resolvePath(domainFolder, "/CONFIG.JSON", config)).toEqual({
      kind: "notFound",
    });
  });

  it("never serves config.json nested in a subdirectory", () => {
    expect(resolvePath(domainFolder, "/sub/config.json", config)).toEqual({
      kind: "notFound",
    });
    expect(resolvePath(domainFolder, "/sub/Config.JSON", config)).toEqual({
      kind: "notFound",
    });
  });

  it("blocks an encoded slash in a ../ traversal (%2e%2e%2f)", () => {
    expect(
      resolvePath(domainFolder, "/%2e%2e%2fdefault/index.html", config),
    ).toEqual({ kind: "notFound" });
  });

  it("blocks ..%2f (encoded trailing slash after dot-dot)", () => {
    expect(
      resolvePath(domainFolder, "/..%2fdefault/index.html", config),
    ).toEqual({ kind: "notFound" });
  });

  it("blocks a mixed-encoding traversal segment", () => {
    expect(
      resolvePath(domainFolder, "/sub/%2e%2e/%2e%2e/config.json", config),
    ).toEqual({ kind: "notFound" });
  });

  it("blocks deeply nested ../ traversal", () => {
    expect(
      resolvePath(domainFolder, "/../../../../etc/passwd", config),
    ).toEqual({ kind: "notFound" });
  });

  it("does not escape the folder for an absolute-looking path", () => {
    // Leading slashes collapse to empty segments; the request can only ever
    // resolve *inside* the domain folder, so /etc/passwd is just a missing file.
    expect(resolvePath(domainFolder, "/etc/passwd", config)).toEqual({
      kind: "notFound",
    });
  });

  it("rejects a backslash traversal segment", () => {
    expect(resolvePath(domainFolder, "/..\\..\\default", config)).toEqual({
      kind: "notFound",
    });
  });

  it("rejects a null byte in the path", () => {
    expect(resolvePath(domainFolder, "/page%00.html", config)).toEqual({
      kind: "notFound",
    });
  });
});
