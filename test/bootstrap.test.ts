import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDomainsDir } from "../src/bootstrap.js";
import type { Config } from "../src/config.js";

let tmp: string;

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
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("ensureDomainsDir", () => {
  it("creates a missing domains root", () => {
    const to = join(tmp, "domains");
    const result = ensureDomainsDir(makeConfig(to));

    expect(result.created).toBe(true);
    expect(result.to).toBe(to);
    expect(existsSync(to)).toBe(true);
  });

  it("creates an empty domains root — nothing is copied in", () => {
    const to = join(tmp, "domains");
    ensureDomainsDir(makeConfig(to));

    expect(readdirSync(to)).toHaveLength(0);
  });

  it("leaves an already-populated domains root untouched", () => {
    const to = join(tmp, "domains");
    mkdirSync(join(to, "example.com"), { recursive: true });
    writeFileSync(join(to, "example.com", "index.html"), "<h1>mine</h1>");

    const result = ensureDomainsDir(makeConfig(to));

    expect(result.created).toBe(false);
    // User content is preserved and no seed content is added.
    expect(readFileSync(join(to, "example.com", "index.html"), "utf8")).toBe("<h1>mine</h1>");
    expect(readdirSync(to)).toEqual(["example.com"]);
  });

  it("leaves an already-existing empty domains root as-is", () => {
    const to = join(tmp, "domains");
    mkdirSync(to, { recursive: true });

    const result = ensureDomainsDir(makeConfig(to));

    expect(result.created).toBe(false);
    expect(readdirSync(to)).toHaveLength(0);
  });
});
