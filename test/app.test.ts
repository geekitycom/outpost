import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { resolve } from "node:path";
import { createApp, VERSION } from "../src/app.js";
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

/** Fetch through the app with a given Host header + optional extra headers. */
function get(path: string, headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://internal${path}`, { headers }));
}

beforeAll(() => {
  // Silence request logging during tests.
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe("app catch-all serving", () => {
  it("keeps /healthz returning ok", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("serves /version with the app version", async () => {
    const res = await get("/version");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(VERSION);
  });

  it("serves the root index for an exact host", async () => {
    const res = await get("/", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Home");
  });

  it("serves an HTML file as-is", async () => {
    const res = await get("/page.html", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain("Page");
  });

  it("serves an image with the right MIME", async () => {
    const res = await get("/logo.png", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("serves .js as static javascript (not executed)", async () => {
    const res = await get("/app.js", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(await res.text()).toBe('console.log("hi");');
  });

  it("renders a .md file to HTML with the extracted title", async () => {
    const res = await get("/notes.md", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<title>Notes</title>");
    expect(body).toContain("<h1>Notes</h1>");
    expect(body).not.toMatch(/https?:\/\//);
  });

  it("renders a .opml file to a collapsible HTML page", async () => {
    const res = await get("/outline.opml", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<title>Sample Outline</title>");
    expect(body).toContain("Top level node");
    expect(body).toContain("<details");
    expect(body).not.toMatch(/s3\.amazonaws\.com|scripting\.com|jquery|bootstrap/i);
  });

  it("serves raw OPML when Accept: text/x-opml is sent", async () => {
    const res = await get("/outline.opml", {
      Host: "example.com",
      Accept: "text/x-opml",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/x-opml/);
    const body = await res.text();
    expect(body).toContain("<opml");
    expect(body).not.toContain("<!doctype html>");
  });

  it("serves raw OPML when ?format=opml is sent", async () => {
    const res = await get("/outline.opml?format=opml", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/x-opml/);
    expect(await res.text()).toContain("<opml");
  });

  it("returns 500 (not a crash) for malformed OPML", async () => {
    const res = await get("/broken.opml", { Host: "example.com" });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("resolves a 3-label host through the wildcard folder", async () => {
    const res = await get("/", { Host: "blog.wild.com" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Wildcard site");
  });

  it("falls back to the default domain for an unknown host", async () => {
    const res = await get("/", { Host: "totally.unknown.org" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Default site");
  });

  it("strips the port from the Host header", async () => {
    const res = await get("/", { Host: "example.com:8080" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Home");
  });

  it("404s a missing file", async () => {
    const res = await get("/nope.html", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("404s a hidden (_) segment", async () => {
    const res = await get("/_hidden/secret.html", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("never serves config.json", async () => {
    const res = await get("/config.json", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("never serves config.json requested with a different case", async () => {
    const res = await get("/Config.json", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("blocks ../ traversal", async () => {
    const res = await get("/../default/index.html", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("blocks encoded ../ traversal (%2e%2e%2f)", async () => {
    const res = await get("/%2e%2e%2fdefault/index.html", {
      Host: "example.com",
    });
    expect(res.status).toBe(404);
  });

  it("blocks a null byte in the path", async () => {
    const res = await get("/page%00.html", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("blocks a backslash traversal segment", async () => {
    const res = await get("/..%5c..%5cdefault", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("returns .js bytes verbatim (never executed) end-to-end", async () => {
    const res = await get("/app.js", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    // The literal source text is returned — not any evaluated result of it.
    expect(await res.text()).toBe('console.log("hi");');
  });

  it("redirects a directory without a trailing slash", async () => {
    const res = await get("/sub", { Host: "example.com" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/sub/");
  });

  it("serves the directory index with a trailing slash", async () => {
    const res = await get("/sub/", { Host: "example.com" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Sub index");
  });

  it("404s a directory with no index", async () => {
    const res = await get("/emptydir/", { Host: "example.com" });
    expect(res.status).toBe(404);
  });

  it("uses X-Forwarded-Host when Host is absent and forwarding is trusted", async () => {
    const res = await get("/", {
      Host: "",
      "X-Forwarded-Host": "example.com",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Home");
  });

  it("404s (does not crash) when no host can be determined", async () => {
    const res = await get("/", { Host: "" });
    expect(res.status).toBe(404);
  });

  it("preserves the query string on a trailing-slash redirect", async () => {
    const res = await get("/sub?a=1", { Host: "example.com" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/sub/?a=1");
  });

  it("uses the first entry of a comma-separated X-Forwarded-Host", async () => {
    const res = await get("/", {
      Host: "",
      "X-Forwarded-Host": "example.com, proxy.internal",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Home");
  });
});

describe("app with trustForwardedHeaders disabled", () => {
  const noTrust = createApp({ ...config, trustForwardedHeaders: false });

  it("ignores X-Forwarded-Host and 404s when Host is absent", async () => {
    const res = await noTrust.fetch(
      new Request("http://internal/", {
        headers: { Host: "", "X-Forwarded-Host": "example.com" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("still routes normally on the real Host header", async () => {
    const res = await noTrust.fetch(
      new Request("http://internal/", { headers: { Host: "example.com" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Home");
  });
});

describe("app with a missing default domain folder", () => {
  const noDefault = createApp({ ...config, defaultDomain: "no-such-default" });

  it("404s (does not crash) for an unknown host when no default folder exists", async () => {
    const res = await noDefault.fetch(
      new Request("http://internal/", {
        headers: { Host: "totally.unknown.example" },
      }),
    );
    expect(res.status).toBe(404);
  });
});
