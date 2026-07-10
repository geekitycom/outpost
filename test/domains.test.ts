import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { normalizeHost, resolveDomainFolder } from "../src/domains.js";
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

describe("resolveDomainFolder", () => {
  it("resolves an exact host folder", () => {
    expect(resolveDomainFolder("example.com", config)).toBe(
      join(domainsDir, "example.com"),
    );
  });

  it("resolves a 3-label host via the wildcard folder", () => {
    expect(resolveDomainFolder("blog.wild.com", config)).toBe(
      join(domainsDir, "*.wild.com"),
    );
  });

  it("falls back to the default domain folder for an unknown host", () => {
    expect(resolveDomainFolder("nope.example.org", config)).toBe(
      join(domainsDir, "default"),
    );
  });

  it("prefers an exact match over the wildcard", () => {
    // example.com is 2 labels so no wildcard applies, but confirm exact wins
    expect(resolveDomainFolder("example.com", config)).toBe(
      join(domainsDir, "example.com"),
    );
  });

  it("does not apply the wildcard to a 2-label host", () => {
    // "wild.com" is only 2 labels; there is a "*.wild.com" folder but it must
    // not be used — falls through to the default.
    expect(resolveDomainFolder("wild.com", config)).toBe(
      join(domainsDir, "default"),
    );
  });

  it("returns the default path even when the default folder is absent", () => {
    // resolveDomainFolder never throws for a missing default; the caller 404s.
    const cfg: Config = { ...config, defaultDomain: "no-such-default" };
    expect(resolveDomainFolder("nobody.example.org", cfg)).toBe(
      join(domainsDir, "no-such-default"),
    );
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
});
