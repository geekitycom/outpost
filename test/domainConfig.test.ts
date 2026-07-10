import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve, join } from "node:path";
import type { Config } from "../src/config.js";
import {
  loadDomainConfig,
  effectiveConfig,
  type DomainConfig,
} from "../src/domainConfig.js";

const domainsDir = resolve(__dirname, "fixtures/domains");
const folder = (name: string): string => join(domainsDir, name);

const baseConfig: Config = {
  port: 3000,
  host: "127.0.0.1",
  domainsDir,
  defaultDomain: "default",
  trustForwardedHeaders: true,
  indexFilename: "index",
  defaultType: "text/html",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadDomainConfig", () => {
  it("returns empty config for a folder without config.json", () => {
    expect(loadDomainConfig(folder("default"))).toEqual({});
  });

  it("reads the whitelisted keys from a valid config.json", () => {
    const cfg = loadDomainConfig(folder("cfg-full.test"));
    expect(cfg.indexFilename).toBe("main");
    expect(cfg.defaultType).toBe("application/json");
    expect(cfg.siteTitle).toBe("Branded Site");
  });

  it("ignores unknown keys (whitelist only)", () => {
    const cfg = loadDomainConfig(folder("cfg-full.test")) as Record<
      string,
      unknown
    >;
    expect(cfg.unknownKey).toBeUndefined();
    expect(cfg.redirects).toBeUndefined();
  });

  it("reads defaultExtension when present", () => {
    expect(loadDomainConfig(folder("cfg-ext.test")).defaultExtension).toBe("md");
  });

  it("falls back to empty config (no throw) for malformed JSON", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadDomainConfig(folder("cfg-bad.test"))).toEqual({});
  });

  it("warns but does not throw for malformed JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadDomainConfig(folder("cfg-bad.test"));
    expect(warn).toHaveBeenCalled();
  });
});

describe("effectiveConfig", () => {
  it("returns the global config unchanged when the domain config is empty", () => {
    const eff = effectiveConfig(baseConfig, {});
    expect(eff.indexFilename).toBe("index");
    expect(eff.defaultType).toBe("text/html");
    expect(eff.defaultExtension).toBeUndefined();
    expect(eff.siteTitle).toBeUndefined();
  });

  it("overrides indexFilename and defaultType from the domain config", () => {
    const domain: DomainConfig = {
      indexFilename: "main",
      defaultType: "application/json",
    };
    const eff = effectiveConfig(baseConfig, domain);
    expect(eff.indexFilename).toBe("main");
    expect(eff.defaultType).toBe("application/json");
  });

  it("carries defaultExtension and siteTitle onto the effective config", () => {
    const eff = effectiveConfig(baseConfig, {
      defaultExtension: "md",
      siteTitle: "Branded Site",
    });
    expect(eff.defaultExtension).toBe("md");
    expect(eff.siteTitle).toBe("Branded Site");
  });

  it("does not mutate the passed-in global config", () => {
    effectiveConfig(baseConfig, { indexFilename: "main" });
    expect(baseConfig.indexFilename).toBe("index");
  });
});
