import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { normalizeHost, domainSearchRoots } from "../src/domains.js";
import type { Config } from "../src/config.js";

const domainsDir = resolve(__dirname, "fixtures/domains");

const config: Config = {
  port: 3000,
  host: "127.0.0.1",
  domainsDir,
  defaultDomain: "default",
  trustForwardedHeaders: true,
  indexFilename: "index",
  defaultType: "text/html",
};

describe("domainSearchRoots", () => {
  it("lists the exact host folder first", () => {
    expect(domainSearchRoots("example.com", config)[0]).toBe(
      join(domainsDir, "example.com"),
    );
  });

  it("includes the wildcard folder second for a 2-label host", () => {
    expect(domainSearchRoots("opml.localhost", config)[1]).toBe(
      join(domainsDir, "*.localhost"),
    );
  });

  it("replaces the leftmost label with a wildcard for a 3-label host", () => {
    expect(domainSearchRoots("blog.wild.com", config)[1]).toBe(
      join(domainsDir, "*.wild.com"),
    );
  });

  it("ends with the default folder then the example fallback when exampleDir is set", () => {
    const exampleDir = resolve(__dirname, "fixtures/example");
    const cfg: Config = { ...config, exampleDir };
    const roots = domainSearchRoots("opml.localhost", cfg);
    expect(roots.slice(-2)).toEqual([
      join(domainsDir, "default"),
      join(exampleDir, "default"),
    ]);
  });

  it("appends no example root when exampleDir is omitted", () => {
    // `config` has no exampleDir; the chain must end at the default folder.
    const roots = domainSearchRoots("opml.localhost", config);
    expect(roots.at(-1)).toBe(join(domainsDir, "default"));
  });

  it("adds no wildcard root for a single-label host", () => {
    const roots = domainSearchRoots("localhost", config);
    expect(roots).toEqual([
      join(domainsDir, "localhost"),
      join(domainsDir, "default"),
    ]);
  });

  it("de-duplicates when the host equals the default domain", () => {
    // "default" resolves to the same folder as the default fallback; list it once.
    const roots = domainSearchRoots("default", config);
    expect(roots).toEqual([join(domainsDir, "default")]);
  });
});

describe("normalizeHost", () => {
  it("returns undefined for missing/empty/whitespace values", () => {
    expect(normalizeHost(undefined)).toBeUndefined();
    expect(normalizeHost(null)).toBeUndefined();
    expect(normalizeHost("")).toBeUndefined();
    expect(normalizeHost("   ")).toBeUndefined();
  });

  it("lowercases the host", () => {
    expect(normalizeHost("Example.COM")).toBe("example.com");
  });

  it("strips a :port suffix", () => {
    expect(normalizeHost("example.com:8080")).toBe("example.com");
  });

  it("uses the first entry of a comma-separated X-Forwarded-Host list", () => {
    expect(normalizeHost("first.example, second.example")).toBe("first.example");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHost("  example.com  ")).toBe("example.com");
  });

  it("rejects hosts containing path separators or empty labels", () => {
    // Guards against path traversal now that roots join the host onto a fs path.
    expect(normalizeHost("../../etc")).toBeUndefined();
    expect(normalizeHost("a\\b")).toBeUndefined();
    expect(normalizeHost("..")).toBeUndefined();
    expect(normalizeHost("a..b")).toBeUndefined();
  });
});
