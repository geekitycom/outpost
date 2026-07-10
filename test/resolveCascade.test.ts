import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { resolveInRoots } from "../src/resolve.js";
import type { Config } from "../src/config.js";

const domainsDir = resolve(__dirname, "fixtures/domains");
const primary = join(domainsDir, "casc-primary");
const fallback = join(domainsDir, "casc-fallback");

const config: Config = {
  port: 3000,
  host: "127.0.0.1",
  domainsDir,
  defaultDomain: "default",
  trustForwardedHeaders: true,
  indexFilename: "index",
  defaultType: "text/html",
};

describe("resolveInRoots", () => {
  it("finds a file present only in a later root via fall-through", () => {
    expect(
      resolveInRoots([primary, fallback], "/only-fallback.html", config),
    ).toEqual({ kind: "file", path: join(fallback, "only-fallback.html") });
  });

  it("lets an earlier root shadow the same file in a later root", () => {
    expect(
      resolveInRoots([primary, fallback], "/shared.html", config),
    ).toEqual({ kind: "file", path: join(primary, "shared.html") });
  });

  it("resolves a file present only in the earlier root", () => {
    expect(
      resolveInRoots([primary, fallback], "/only-primary.html", config),
    ).toEqual({ kind: "file", path: join(primary, "only-primary.html") });
  });

  it("returns notFound when the path is missing from every root", () => {
    expect(
      resolveInRoots([primary, fallback], "/nowhere.html", config),
    ).toEqual({ kind: "notFound" });
  });

  it("preserves per-root path security (traversal and hidden segments)", () => {
    expect(
      resolveInRoots([primary, fallback], "/../secret", config),
    ).toEqual({ kind: "notFound" });
    expect(resolveInRoots([primary, fallback], "/_x/y", config)).toEqual({
      kind: "notFound",
    });
  });

  it("falls through to redirect a directory owned only by a later root", () => {
    expect(resolveInRoots([primary, fallback], "/sub", config)).toEqual({
      kind: "redirect",
      location: "/sub/",
    });
  });

  it("returns notFound for an empty roots array", () => {
    expect(resolveInRoots([], "/only-fallback.html", config)).toEqual({
      kind: "notFound",
    });
  });
});
