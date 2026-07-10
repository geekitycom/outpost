# Outpost

A folder-based HTTP server that serves static and rendered pages **per domain**.
Drop HTML, OPML, Markdown, images, or arbitrary static files into a per-domain
folder and Outpost serves them correctly for that domain, routed by the request's
`Host` header.

It is a modern, self-contained [Hono](https://hono.dev/) + TypeScript app,
inspired by Dave Winer's PagePark.

---

## What it does

- Routes each request to a domain folder based on the `Host` header
  (exact match → wildcard → default fallback).
- Serves static files (HTML, images, JS, anything) with a correct MIME type.
- Renders **Markdown** (`.md`) and **OPML** (`.opml`) to self-contained HTML.
- Supports an optional, minimal per-domain `config.json`.
- Terminates behind a reverse proxy (Caddy) that handles TLS and virtual hosts.

It intentionally does **not** run node apps, execute `.js` files, do S3/GitHub
serving, WebSockets, remote mirroring/proxying, redirects, or `eval` — all of which
existed in the legacy implementation and were deliberately removed.

---

## Quick start

Requires **Node 24+** (the active LTS). This project uses **pnpm**, provisioned via
[corepack](https://nodejs.org/api/corepack.html) (bundled with Node) — the exact
version is pinned by the `packageManager` field in `package.json`, so you don't
install pnpm globally.

```sh
corepack enable      # one-time: activates the pinned pnpm
pnpm install
pnpm dev             # hot-reload dev server (tsx watch), on http://127.0.0.1:3000
```

On first boot, if the domains root (`./domains` by default) is missing or empty,
Outpost seeds it from the committed `domains.example/` template — so a fresh
checkout, or a freshly mounted Docker volume, serves a welcome page immediately.
An already-populated domains root is never overwritten.

Visit the seeded page, then replace it with your own content:

```sh
curl http://127.0.0.1:3000/            # → the seeded welcome page
curl http://127.0.0.1:3000/healthz     # → ok
echo '<h1>Hello from Outpost</h1>' > domains/default/index.html
```

### Scripts

| Command           | What it does                                            |
|-------------------|---------------------------------------------------------|
| `pnpm dev`        | Run locally with hot reload (`tsx watch src/index.ts`). |
| `pnpm build`      | Compile TypeScript → `dist/` (the production path).     |
| `pnpm start`      | Run the compiled output (`node dist/index.js`).         |
| `pnpm typecheck`  | `tsc --noEmit` — must stay clean.                       |
| `pnpm test`       | Run the vitest suite.                                   |

---

## How domain folders work

The domains root (default `./domains`, configurable via `OUTPOST_DOMAINS_DIR`)
contains one folder per domain:

```
domains/
├── example.com/          # exact host match
│   └── index.html
├── *.example.net/        # wildcard: matches any a.example.net
│   └── index.html
└── default/              # fallback when nothing else matches
    └── index.html
```

**Host → folder resolution** for a resolved host (`Host` header, lowercased,
`:port` stripped):

1. `domains/<host>` if that folder exists.
2. Otherwise, if the host has 3 labels (`a.b.c`), try the **wildcard**
   `domains/*.b.c` (first label replaced with `*`).
3. Otherwise, fall back to `domains/<OUTPOST_DEFAULT_DOMAIN>` (default `default`).

If the `Host` header is missing and `TRUST_FORWARDED_HEADERS` is on, Outpost
falls back to `X-Forwarded-Host`. A missing host never crashes the server — it
serves a 404 page.

### Path → file resolution & security

Within a domain folder:

- The URL path is decoded and resolved against the folder.
- **Path traversal is blocked** — the resolved path must stay inside the domain
  folder (`..`, encoded variants, backslash, and null-byte tricks are rejected).
- **Hidden segments are rejected**: any path segment starting with `_` or `.` → 404.
- A domain's **`config.json` is never served** → 404.
- **Directory requests:** a directory URL without a trailing slash gets a 301
  redirect to add it; with a trailing slash, Outpost looks for an index file
  (`<indexFilename>.<ext>`, default base `index`) and serves the first match, else 404.
- Missing files return a self-contained 404 page.

---

## Supported file types & rendering

| Extension        | Behavior                                                                                                   |
|------------------|------------------------------------------------------------------------------------------------------------|
| `.md`            | Rendered Markdown → HTML in a self-contained template. The first `# H1` becomes the title (else the file name). `Content-Type: text/html`. |
| `.opml`          | Rendered outline → collapsible HTML; each headline's `text` is rendered as inline Markdown (links, `## ` headings, and raw HTML pass through). Headline attributes `flBulletedSubs`/`flNumberedSubs` mark subs with bullets/numbers and `collapse="true"` starts them collapsed. `text/html`. **Except**: with `Accept: text/x-opml` or `?format=opml`, the raw OPML XML is served as `text/x-opml`. |
| `.html`, `.htm`  | Served as-is, `text/html`.                                                                                  |
| `.js`            | Served as a **static** file (`text/javascript`) — never executed.                                          |
| images / other   | Served as-is with a MIME type derived from the extension.                                                   |
| no extension     | Served with the configured default type (default `text/html`), unless `defaultExtension` applies (below).  |

Markdown and OPML rendering are done server-side with our own inline CSS/JS —
nothing is fetched from a CDN or any third-party host. Malformed OPML returns a
plain-text 500 rather than crashing.

---

## Per-domain `config.json` (optional)

Place an optional `config.json` at the root of a domain folder. Only these keys are
read (all values must be non-empty strings); **unknown keys are ignored**, and a
missing/malformed file degrades gracefully to defaults (a warning is logged) without
crashing:

| Key                | Effect                                                                                                   |
|--------------------|----------------------------------------------------------------------------------------------------------|
| `indexFilename`    | Overrides the default `"index"` base name for directory index discovery.                                 |
| `defaultType`      | Overrides the Content-Type served for extension-less files (default `"text/html"`).                      |
| `defaultExtension` | An extension-less file is served as if it had `.<defaultExtension>` (e.g. `md`/`opml` render). A real extension always wins; this takes precedence over `defaultType` for genuinely extension-less files. |
| `siteTitle`        | Fallback page title for the Markdown/OPML wrappers when the document has no `# H1` / `<title>`. The document's own title still wins. |

`config.json` itself is never served (404). It is read per request.

---

## Configuration (environment variables)

All configuration comes from environment variables (see `src/config.ts`):

| Variable                  | Default       | Description                                                                                     |
|---------------------------|---------------|-------------------------------------------------------------------------------------------------|
| `PORT`                    | `3000`        | HTTP port to listen on (Caddy `reverse_proxy` targets this).                                    |
| `HOST`                    | `127.0.0.1`   | Bind address. Reachable only via the proxy by default; set `0.0.0.0` inside Docker.            |
| `OUTPOST_DOMAINS_DIR`    | `./domains`   | Path to the domains root directory. In Docker this is a mounted volume.                         |
| `OUTPOST_DEFAULT_DOMAIN` | `default`     | Folder name used when no exact/wildcard domain folder matches.                                  |
| `OUTPOST_INDEX_FILENAME` | `index`       | Base name (no extension) of a directory's index file.                                           |
| `OUTPOST_DEFAULT_TYPE`   | `text/html`   | Content-Type served for extension-less files.                                                   |
| `TRUST_FORWARDED_HEADERS` | `on`          | Trust `X-Forwarded-Host` as a fallback when `Host` is absent/rewritten. Set `off` if Outpost is ever exposed directly (not behind a trusted proxy). |

Booleans accept `1/true/on/yes` and `0/false/off/no`.

There is **no TLS in-app** — Caddy terminates HTTPS and reverse-proxies to
`localhost:PORT`.

### Operational endpoints

- `GET /healthz` → `ok` (plain text) — for Docker/Caddy health checks.
- `GET /version` → the app version.

Basic request logging (method, host, path, status) goes to stdout.

---

## Deployment (Docker + Dockge + Caddy)

The image builds TypeScript in a build stage and runs the compiled JS on a slim
Node base with production dependencies only, as a non-root user.

### Build & run with Docker

```sh
docker build -t outpost:latest .

docker run --rm -p 127.0.0.1:3000:3000 \
  -v "$PWD/domains:/domains" \
  outpost:latest

curl http://127.0.0.1:3000/healthz     # → ok
```

The container defaults to `HOST=0.0.0.0` and `OUTPOST_DOMAINS_DIR=/domains`.
Publishing as `127.0.0.1:3000:3000` keeps it reachable only from the host (and
thus only through Caddy).

### Compose (Dockge-friendly)

A `compose.yaml` is included. It builds the image, publishes `127.0.0.1:3000:3000`,
mounts `./domains` → `/domains`, sets the env vars above, and uses
`restart: unless-stopped` with a `/healthz` healthcheck. Point the volume at
wherever your host keeps its domain content:

```sh
docker compose up -d --build
```

### Caddy (TLS + virtual hosts)

Caddy on the host terminates HTTPS and reverse-proxies to Outpost. Caddy v2
**preserves the original `Host` header by default**, which is exactly what
Outpost routes on — no extra proxy config is needed. A sample `Caddyfile` is
included:

```caddyfile
example.com, www.example.com {
	reverse_proxy localhost:3000
}

blog.example.org {
	reverse_proxy localhost:3000
}

*.example.net {
	reverse_proxy localhost:3000
}
```

List every domain Outpost serves; they can all target the same upstream, and
Outpost picks the matching `domains/<host>` folder from the forwarded `Host`
header.

---

## Development

- **Node 24+, ESM, TypeScript strict** (`NodeNext` resolution). Relative imports
  use the `.js` extension even in `.ts` files (e.g. `import { loadConfig } from "./config.js"`)
  — this is correct for NodeNext, not a typo.
- Source lives in `src/`; entry is `src/index.ts` → `createApp()` in `src/app.ts`.
- Configuration comes only from env vars via `src/config.ts`.

### Tests & typecheck

```sh
pnpm test           # vitest run
pnpm typecheck      # tsc --noEmit
pnpm build          # compile to dist/
```

---

## License

MIT — see [LICENSE](./LICENSE).
