import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { serveFile } from "../src/serve.js";
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

describe("serveFile", () => {
  it("serves an HTML file with text/html and its contents", async () => {
    const res = await serveFile(join(domainFolder, "page.html"), config);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain("Page");
  });

  it("serves an image with the correct MIME and identical bytes", async () => {
    const res = await serveFile(join(domainFolder, "logo.png"), config);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = new Uint8Array(await res.arrayBuffer());
    const onDisk = new Uint8Array(readFileSync(join(domainFolder, "logo.png")));
    expect(body).toEqual(onDisk);
  });

  it("serves .js as javascript, unexecuted (raw source text)", async () => {
    const res = await serveFile(join(domainFolder, "app.js"), config);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(await res.text()).toBe('console.log("hi");');
  });

  it("renders a .md file to a self-contained HTML page", async () => {
    const res = await serveFile(join(domainFolder, "notes.md"), config);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<title>Notes</title>");
    expect(body).toContain("<h1>Notes</h1>");
    expect(body).toContain("hello");
    expect(body).not.toMatch(/https?:\/\//);
  });

  it("renders a .opml file to a self-contained HTML page by default", async () => {
    const res = await serveFile(join(domainFolder, "outline.opml"), config);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<title>Sample Outline</title>");
    expect(body).toContain("Top level node");
  });

  it("serves raw OPML for ?format=opml", async () => {
    const res = await serveFile(join(domainFolder, "outline.opml"), config, {
      format: "opml",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/x-opml/);
    const body = await res.text();
    expect(body).toContain("<opml");
    expect(body).not.toContain("<!doctype html>");
  });

  it("serves raw OPML for Accept: text/x-opml", async () => {
    const res = await serveFile(join(domainFolder, "outline.opml"), config, {
      accept: "text/x-opml",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/x-opml/);
    expect(await res.text()).toContain("<opml");
  });

  it("returns 500 plain text for malformed OPML (no crash)", async () => {
    const res = await serveFile(join(domainFolder, "broken.opml"), config);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });
});
