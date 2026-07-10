import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { loadDomainConfigCascade } from "../src/domainConfig.js";

const domainsDir = resolve(__dirname, "fixtures/domains");
const folder = (name: string): string => join(domainsDir, name);

describe("loadDomainConfigCascade", () => {
  it("returns a single root's config unchanged", () => {
    expect(loadDomainConfigCascade([folder("cfgcasc-domain")])).toEqual({
      siteTitle: "Domain Title",
    });
  });

  it("merges: specific root overrides, omitted keys inherit from fallback", () => {
    const cfg = loadDomainConfigCascade([
      folder("cfgcasc-domain"),
      folder("cfgcasc-fallback"),
    ]);
    expect(cfg.siteTitle).toBe("Domain Title");
    expect(cfg.defaultExtension).toBe("md");
  });

  it("honours precedence direction: index 0 wins on conflict", () => {
    const cfg = loadDomainConfigCascade([
      folder("cfgcasc-fallback"),
      folder("cfgcasc-domain"),
    ]);
    expect(cfg.siteTitle).toBe("Fallback Title");
  });

  it("skips a root that has no config.json", () => {
    const cfg = loadDomainConfigCascade([
      folder("cfgcasc-domain"),
      folder("default"),
    ]);
    expect(cfg).toEqual({ siteTitle: "Domain Title" });
  });

  it("returns an empty config for an empty roots array", () => {
    expect(loadDomainConfigCascade([])).toEqual({});
  });
});
