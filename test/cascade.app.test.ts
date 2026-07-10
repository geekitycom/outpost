import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";

const domainsDir = resolve(__dirname, "fixtures/domains");
const exampleDir = resolve(__dirname, "..", "domains.example");

/** Base config; individual suites tweak `domainsDir` / `exampleDir` as needed. */
const config: Config = {
  port: 3000,
  host: "127.0.0.1",
  domainsDir,
  defaultDomain: "default",
  trustForwardedHeaders: true,
  indexFilename: "index",
  defaultType: "text/html",
};

/** Fetch through `app` with a given Host header. */
function get(app: ReturnType<typeof createApp>, path: string, host: string) {
  return app.fetch(new Request(`http://internal${path}`, { headers: { Host: host } }));
}

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe("cascade end-to-end", () => {
  it("falls through to a later root when the matched folder lacks the file", async () => {
    // `exact.casc6.test` (3-label) has its own folder but no `shared.html`; the
    // wildcard root `*.casc6.test` — a later entry in the cascade — supplies it.
    const app = createApp(config);
    const res = await get(app, "/shared.html", "exact.casc6.test");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("from wildcard root");
  });

  it("renders the styled 404 template from the cascade for a missing path", async () => {
    // With exampleDir set, the cascade ends at domains.example/default whose
    // _templates/404.eta is the styled page (a centered layout the embedded
    // fallback lacks).
    const app = createApp({ ...config, exampleDir });
    const res = await get(app, "/no-such-page.html", "example.com");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("404");
    // Distinctive to the styled 404.eta — proves the cascade loaded it, not the
    // minimal embedded NOT_FOUND_FALLBACK.
    expect(body).toContain("justify-content: center");
  });

  it("wraps a .md file in the styled markdown template found via the cascade", async () => {
    // example.com has no _templates; the cascade falls to
    // domains.example/default/_templates/markdown.eta (the styled version).
    const app = createApp({ ...config, exampleDir });
    const res = await get(app, "/notes.md", "example.com");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<h1>Notes</h1>");
    // The link color `#0969da` appears only in the styled markdown.eta, never in
    // the embedded MARKDOWN_FALLBACK — so the cascade template won.
    expect(body).toContain("#0969da");
  });

  it("serves the example-dir welcome page when no default folder exists locally", async () => {
    // A domains root with NO `default` folder: an unknown host's cascade skips
    // every local root and lands on domains.example/default (the example welcome).
    const noDefaultDir = resolve(__dirname, "fixtures/cascade-nodefault");
    const app = createApp({ ...config, domainsDir: noDefaultDir, exampleDir });
    const res = await get(app, "/", "unknown.example");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Welcome to Outpost");
  });
});
