import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDomainsDir } from "../src/bootstrap.js";
import type { Config } from "../src/config.js";

let tmp: string;
let source: string;

function makeConfig(domainsDir: string): Config {
  return {
    port: 3000,
    host: "127.0.0.1",
    domainsDir,
    defaultDomain: "default",
    trustForwardedHeaders: true,
    indexFilename: "index",
    defaultType: "text/html",
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "outpost-bootstrap-"));
  // A stand-in for domains.example/ with a nested default domain.
  source = join(tmp, "seed");
  mkdirSync(join(source, "default"), { recursive: true });
  writeFileSync(join(source, "default", "index.html"), "<h1>seed</h1>");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("ensureDomainsDir", () => {
  it("seeds a missing domains root by copying the source", () => {
    const to = join(tmp, "domains");
    const result = ensureDomainsDir(makeConfig(to), source);

    expect(result.seeded).toBe(true);
    expect(result.from).toBe(source);
    expect(result.to).toBe(to);
    expect(readFileSync(join(to, "default", "index.html"), "utf8")).toBe("<h1>seed</h1>");
  });

  it("seeds an existing but empty domains root (e.g. a freshly mounted volume)", () => {
    const to = join(tmp, "domains");
    mkdirSync(to, { recursive: true });

    const result = ensureDomainsDir(makeConfig(to), source);

    expect(result.seeded).toBe(true);
    expect(existsSync(join(to, "default", "index.html"))).toBe(true);
  });

  it("leaves an already-populated domains root untouched", () => {
    const to = join(tmp, "domains");
    mkdirSync(join(to, "example.com"), { recursive: true });
    writeFileSync(join(to, "example.com", "index.html"), "<h1>mine</h1>");

    const result = ensureDomainsDir(makeConfig(to), source);

    expect(result.seeded).toBe(false);
    // User content is preserved and the seed is NOT copied in.
    expect(readFileSync(join(to, "example.com", "index.html"), "utf8")).toBe("<h1>mine</h1>");
    expect(existsSync(join(to, "default"))).toBe(false);
  });

  it("does not throw or seed when the source directory is absent", () => {
    const to = join(tmp, "domains");
    const result = ensureDomainsDir(makeConfig(to), join(tmp, "no-such-seed"));

    expect(result.seeded).toBe(false);
    expect(existsSync(to)).toBe(false);
  });
});
