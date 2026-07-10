import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
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

const app = createApp(config);

/** Fetch through the app with a given Host header. */
function get(path: string, host: string, headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://internal${path}`, { headers: { Host: host, ...headers } }));
}

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe("per-domain config.json threading", () => {
  it("uses config.json indexFilename for directory index discovery", async () => {
    const res = await get("/", "cfg-full.test");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Custom main index");
  });

  it("uses config.json defaultType for an extension-less file", async () => {
    const res = await get("/data", "cfg-full.test");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toContain('"n":1');
  });

  it("renders an extension-less file as Markdown when defaultExtension is md", async () => {
    const res = await get("/readme", "cfg-ext.test");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<h1>Rendered Readme</h1>");
    expect(body).toContain("<title>Rendered Readme</title>");
  });

  it("renders an extension-less file as OPML when defaultExtension is opml", async () => {
    const res = await get("/outline", "cfg-ext-opml.test");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<title>Extensionless Outline</title>");
    expect(body).toContain("A node without a file extension");
  });

  it("uses config.json siteTitle as the Markdown fallback title (no H1)", async () => {
    const res = await get("/notitle.md", "cfg-full.test");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>Branded Site</title>");
  });

  it("falls back to defaults (no crash) when config.json is malformed", async () => {
    const res = await get("/", "cfg-bad.test");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Fallback works");
  });

  it("never serves config.json, even for a domain that has one", async () => {
    const res = await get("/config.json", "cfg-full.test");
    expect(res.status).toBe(404);
  });
});
