# Outpost

A folder-based HTTP server that serves static and rendered pages **per domain**.
Drop HTML, OPML, Markdown, images, or arbitrary static files into a per-domain
folder and Outpost serves them correctly for that domain, routed by the request's
`Host` header.

It is a modern, self-contained [Hono](https://hono.dev/) + TypeScript app,
inspired by Dave Winer's PagePark.

---

## What it does

- Routes each request through an ordered **cascade** of domain folders selected
  by the `Host` header (exact match → wildcard → default → shipped example
  default). File, `config.json`, and template lookups all walk this cascade, and
  the most-specific root that has an answer wins.
- Serves static files (HTML, images, JS, anything) with a correct MIME type.
- Renders **Markdown** (`.md`) and **OPML** (`.opml`) to self-contained HTML via
  [Eta](https://eta.js.org) templates that are overridable per domain.
- Supports an optional, minimal per-domain `config.json` (merged down the cascade).
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

On first boot, if the domains root (`./domains` by default) is missing, Outpost
creates it **empty** — nothing is copied into it. Requests that no local folder
answers fall through to the committed `domains.example/default/` as the final
cascade fallback, so a fresh checkout (or a freshly mounted Docker volume) still
serves the welcome page immediately without seeding anything.

Visit the welcome page, then add your own content — a local `domains/default/`
shadows the example fallback:

```sh
curl http://127.0.0.1:3000/            # → the example welcome page (cascade fallback)
curl http://127.0.0.1:3000/healthz     # → ok
mkdir -p domains/default
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
└── default/              # local fallback when nothing else matches
    └── index.html
```

**Host → cascade of roots.** A resolved host (`Host` header, lowercased, `:port`
stripped) does not pick a single folder — it expands into an ordered, de-duplicated
list of candidate roots, most-specific first:

1. `domains/<host>` (exact).
2. `domains/*.<rest>` — the **wildcard**, with the leftmost label replaced by `*`,
   for any host of **2+ labels** (`opml.localhost` → `*.localhost`,
   `blog.wild.com` → `*.wild.com`).
3. `domains/<OUTPOST_DEFAULT_DOMAIN>` (default `default`) — the local fallback.
4. `domains.example/<OUTPOST_DEFAULT_DOMAIN>` — the shipped example default, the
   final fallback before a 404.

Every lookup — the requested file, the merged `config.json`, and the page
templates — walks this list in order, and the first root that answers wins (so an
earlier root shadows later ones, and a request missing in one root falls through
to the next). This is how a bare checkout still serves the example welcome page:
no local root answers, so the request lands on `domains.example/default`.

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
- Missing files return a self-contained 404 page (rendered from the `404`
  template found in the cascade, else a built-in fallback — see **Templates**).

---

## Supported file types & rendering

| Extension        | Behavior                                                                                                   |
|------------------|------------------------------------------------------------------------------------------------------------|
| `.md`            | Rendered Markdown → HTML in a self-contained template. The first `# H1` becomes the title (else the file name). `Content-Type: text/html`. |
| `.opml`          | Rendered outline → collapsible HTML; each headline's `text` is rendered as inline Markdown (links, `## ` headings, and raw HTML pass through). Headline attributes `flBulletedSubs`/`flNumberedSubs` mark subs with bullets/numbers and `collapse="true"` starts them collapsed. `text/html`. **Except**: with `Accept: text/x-opml` or `?format=opml`, the raw OPML XML is served as `text/x-opml`. |
| `.html`, `.htm`  | Served as-is, `text/html`. Not cached, so in-place edits are served fresh.                                  |
| `.js`            | Served as a **static** file (`text/javascript`) — never executed.                                          |
| images / other   | Served as-is with a MIME type derived from the extension.                                                   |
| no extension     | Served with the configured default type (default `text/html`), unless `defaultExtension` applies (below).  |

Markdown and OPML rendering are done server-side. Page templates share a common
Eta **layout** (`_templates/layout.eta`) and pull their styles from external,
cache-friendly stylesheets under `css/` — the layout links a same-origin
`/css/base.css` plus a per-page sheet (`markdown.css`, `opml.css`, `404.css`)
rather than inlining CSS — and it references a standard favicon/manifest set
(`favicon.ico`, `favicon-*.png`, `apple-touch-icon.png`,
`android-chrome-*.png`, `site.webmanifest`). These assets are served through the
**same cascade** as everything else, so a domain can override `css/*.css` or its
favicons. Everything is same-origin, served by Outpost itself — nothing is
fetched from a CDN or any third-party host. Malformed OPML returns a plain-text
500 rather than crashing.

**Caching:** non-HTML static assets (CSS, favicons, images, JS) are sent with
`Cache-Control: public, max-age=3600` and a `Last-Modified` header so browsers
reuse them across page loads. HTML — both static `.html` files and rendered
Markdown/OPML pages — is sent uncached so edits appear immediately.

---

## Templates

The Markdown, OPML, and 404 pages are wrapped in [Eta](https://eta.js.org)
templates loaded from a domain's `_templates/` folder:

```
domains/example.com/_templates/
├── markdown.eta      # wraps rendered Markdown
├── opml.eta          # wraps rendered OPML outlines
└── 404.eta           # the not-found page
```

Templates are resolved **through the same cascade** as files: a request looks for
`_templates/<name>.eta` in each root in order (exact host → wildcard → default →
example default) and uses the first one found, so you can override one page for a
single domain and inherit the rest. The styled defaults ship in
`domains.example/default/_templates/` (`markdown.eta`, `opml.eta`, `404.eta`). If
no root supplies a template, a minimal self-contained fallback (embedded in the
binary) is used, so rendering never fails for lack of a template.

Each template receives its slots via Eta's `it`: `<%= it.x %>` HTML-escapes a
value, `<%~ it.x %>` emits already-built HTML raw. `markdown.eta` gets
`title`/`body`; `opml.eta` gets `title`/`header`/`meta`/`body`; `404.eta` gets an
optional `path`. Templates are trusted content — `_templates/` itself is never
served (any `_`-prefixed segment is a 404).

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

`config.json` is **merged down the cascade**: each root's file is read and
overlaid most-specific-first, so an exact-host `config.json` overrides the
default's, key by key, and a root with no (or a malformed) file contributes
nothing. `config.json` itself is never served (404). It is read per request.

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
