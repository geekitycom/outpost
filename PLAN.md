# Outpost → Modern Hono Port — PLAN

A plan for Outpost, a modern, self-contained app inspired by Dave Winer's PagePark, built on
[Hono](https://hono.dev/) + Node + TypeScript, keeping the one feature that
matters: **drop HTML / OPML / Markdown files into a per-domain folder and have them
served correctly for that domain.**

Status: **COMPLETE.** All milestones done — 1 (scaffold), 2 (domain resolution + static
serving — the HTML/image MVP), 3 (Markdown rendering), 4 (OPML rendering +
raw-OPML negotiation), 5 (per-domain `config.json` whitelist loader), 6
(vitest suite per §9 — 120 tests), 7 (Docker + `.dockerignore` + `compose.yaml`
+ `Caddyfile` + README rewrite), and 8 (cleanup — legacy files removed, final
dependency audit). The modern Hono app under `src/` is the whole project now;
the legacy reference implementation has been deleted.

---

## 0. Working agreement (read this first)

**If you're an agent/contributor picking this up, know this before writing code:**

### Commands
Package manager is **pnpm** (via corepack; pinned by `packageManager` in `package.json`). Run `corepack enable` once, then `pnpm install`.
- `pnpm dev` — run locally with hot reload (`tsx watch src/index.ts`).
- `pnpm build` — compile TS → `dist/` (this is the Docker/production path).
- `pnpm start` — run compiled output (`node dist/index.js`).
- `pnpm typecheck` — `tsc --noEmit`. Must stay clean.
- `pnpm test` — `vitest run`.

### Conventions
- **Node 20+, ESM, TypeScript strict** (`NodeNext` resolution). Because of NodeNext,
  **relative imports must use the `.js` extension** even in `.ts` files
  (`import { loadConfig } from "./config.js"`). This is correct, not a typo.
- Source lives in `src/`; entry is `src/index.ts` → `createApp()` in `src/app.ts`.
- Config comes only from env vars via `src/config.ts` (see §7). App binds `127.0.0.1`
  by default. Don't read env directly elsewhere — extend `Config`.
- **Verify changes by actually running the app** (dev *and* the `build` → `node dist/`
  path), not just typecheck — the Docker image runs compiled JS with prod deps only.

### Hard constraints (non-negotiable — the whole point of this port)
- **No external services at runtime.** No S3, no GitHub API, no calls to `scripting.com`
  or any third-party host. Everything renders/serves locally.
- **No CDN assets.** All CSS/JS is inlined into templates.
- **No Dave packages** (`pagepark`, `daveutils`, `daves3`, `davediskspace`, `githubpub`,
  `opmltojs`) and **no deprecated packages** (`request`, `forever`, `nodejs-websocket`).
  Prefer small, well-maintained deps.
- **Frontend:** no Bootstrap, no jQuery, no frameworks (React/Vue/etc.). Hand-written
  custom CSS + lightweight vanilla JS only (see §5).
- **Security musts** in path handling: block `..` traversal, reject `_`/dot-prefixed
  segments, never serve a domain's `config.json` (see §3.2).

### When you finish a chunk of work
- Tick the milestone in §10 and update the **Status** line above.
- Keep §7 (env vars) and this section in sync with the code if either changes.
- Update the project memory note (`outpost-hono-port`) if a key decision changes.

### Legacy reference
- The original implementation (`pagepark.js`, `cli/`, `prefs/`, `templates/`, `docs/`,
  `source.opml`, `worknotes.md`) was kept only as reference and has now been **removed**
  by milestone 8. It is gone from the repo; consult git history if you need it. The new
  app never wired any of it in. (A real-world OPML sample lives on as the test fixture
  `test/fixtures/domains/example.com/source.opml` — that copy is kept.)

---

## 1. Goal & guiding principles

- **Keep the core:** folder-per-domain static + rendered serving (HTML, OPML, Markdown,
  images, arbitrary static files), routed by the `Host` header.
- **Modern & maintainable:** Hono + TypeScript, small well-maintained dependencies,
  ES modules, a test suite, a Dockerfile.
- **Fully self-contained:** no external services (no S3, no GitHub API, no calls out to
  `scripting.com`). OPML and Markdown render server-side with our own inline
  CSS/JS. Nothing at runtime depends on a third-party host.
- **No Dave packages, no deprecated packages:** remove `pagepark`, `daveutils`,
  `daves3`, `davediskspace`, `githubpub`, `opmltojs`, `request`, `forever`,
  `forever-monitor`, `nodejs-websocket`, `require-from-string`, `child_process`.

---

## 2. What we remove (explicitly out of scope)

All of the following, currently tangled through `pagepark.js`, gets **cut**:

- **Running node apps / persistent + chronological scripts** — `forever`, child
  processes, `filter.js`, `.js` file execution, port delegation / `domainMap` /
  `findAppWithDomain`, the CLI management port (`handleCliRequest`, `/list`, `/stop`,
  `/restart`, `/rescan`).
- **S3** — `daves3`, `fargoS3Path`, `s3Path`, `s3ServeFromPath`, `serveFromS3*`.
- **GitHub serving** — `githubpub`, `githubServeFrom`, `serveFromGithubRepo`.
- **WebSockets** — `nodejs-websocket`, `notifySocketSubscribers`, `flWebsockets*`.
- **Remote mirror / proxy** — `urlSiteContents`, `mirrors`, `serveMirrorWithPagePark`,
  `delegateRequest` (all used `request`).
- **All redirect config machinery** — `redirects`, `urlSiteRedirect`, `jsSiteRedirect`
  (arbitrary `eval`), and the content-based `#pagePark` redirect files. *(User confirmed
  these aren't needed. If we ever want static redirects back, add them as a small,
  safe config feature — never `eval`.)*
- **Free disk space / news-product endpoints** — `davediskspace`, `runNewsProduct`,
  `/freediskspace`, `/isdomainvalid`.
- **Stats persistence & templates-over-HTTP caching** — `prefs/stats.json`,
  `hitsByDomain`, fetching default templates from `scripting.com`.

---

## 3. Core behavior we keep (the spec)

### 3.1 Request → domain folder resolution

**Determining the host.** Read the `Host` header; if it's missing/empty and
`TRUST_FORWARDED_HEADERS` is on (§7), fall back to `X-Forwarded-Host`. Then strip any
`:port` suffix and lowercase. If we still have no host, serve the 404 page — never let
an `undefined` host crash the server (Dave got bitten by exactly this).

- Behind Caddy this Just Works: Caddy v2's `reverse_proxy` **preserves the original
  `Host` header by default** (unlike nginx, which rewrites it to the upstream address),
  so the real requested domain reaches us intact. Caddy also sets `X-Forwarded-Host`,
  `X-Forwarded-Proto`, and `X-Forwarded-For` automatically — hence the fallback.
- Forwarded headers are client-spoofable in general, but Outpost only ever listens on
  `127.0.0.1:PORT` behind the proxy, so anything reaching it has already passed through
  Caddy. `TRUST_FORWARDED_HEADERS` makes that assumption explicit (default on).

Given the resolved host:

1. `domains/<host>` if that folder exists.
2. Otherwise, **wildcard**: if host has 3 labels (`a.b.c`), try
   `domains/*.b.c` (replace the first label with `*`).
3. Otherwise, fall back to `domains/default`.

The domains root is **configurable** (env var — see §7), defaulting to `./domains`.
This fixes Dave's long-standing pain (he resorted to a symlink); in Docker it's a
mounted volume.

### 3.2 Path → file resolution within a domain folder

- URL-decode the path, then resolve it against the domain folder.
- **Security (must-have):**
  - Reject path traversal — resolved absolute path must stay inside the domain folder
    (guard against `..`, encoded variants, symlink escape).
  - Reject **hidden** segments: any path segment starting with `_` or `.` → 404.
  - Never serve `config.json` from a domain folder → 404.
- **Directory requests:**
  - If the resolved path is a directory and the URL has no trailing slash → 301/302
    redirect to add the trailing slash.
  - If it's a directory with a trailing slash → look for an index file
    `index.<ext>` (configurable base name, default `index`); serve the first match.
    No index → 404.
- **File requests:** serve the file, applying extension processing (§3.3).
- Missing file → 404 (custom error page, §3.4).

### 3.3 Extension processing

| Extension        | Behavior                                                                                     |
|------------------|----------------------------------------------------------------------------------------------|
| `.md`            | Render Markdown → HTML, wrapped in a self-contained template. `Content-Type: text/html`.     |
| `.opml`          | Render outline → collapsible HTML (self-contained). `text/html`. **Except**: if `Accept: text/x-opml` or `?format=opml`, serve raw OPML as `text/x-opml` (XML). |
| `.html`, `.htm`  | Served as-is, `text/html`.                                                                     |
| images / other   | Served as-is with a MIME type derived from the extension (via `mime-types`).                  |
| no extension     | Served with a configurable default type (default `text/html`).                                |
| `.js`            | **Served as a static file** (`text/javascript`) — never executed.                            |

### 3.4 Misc endpoints & errors

- `404`: return a simple custom error page (a local template; `prefs/error.html`
  equivalent, self-contained).
- `/healthz`: plain-text `ok` for Docker/Caddy health checks (matched before host routing).
- `/version`: returns the app version (nice-to-have; low priority).
- Keep basic request logging to stdout (method, host, path, status) — Docker captures it.

---

## 4. Per-domain `config.json` (optional, minimal)

Support an **optional** `config.json` at the root of a domain folder, with a small,
safe whitelist. No redirects, no remote fetching, no code eval. Implemented keys:

- `indexFilename` (overrides the default `"index"`) — affects directory index discovery.
- `defaultType` (overrides the default `"text/html"`) — Content-Type for extension-less files.
- `defaultExtension` (optional) — an extension-less file is served as if it carried
  `.<defaultExtension>` (e.g. `md`/`opml` render; other extensions set the MIME).
  Precedence: a file's real extension always wins; `defaultExtension` only applies to
  genuinely extension-less files, and takes precedence over `defaultType` for them.
- `siteTitle` (optional) — fallback page title for the Markdown/OPML wrappers, used when
  the document itself has no `# H1` / `<head><title>`. A document's own title still wins.

Only these keys (all values must be non-empty strings) are read; **unknown keys are
ignored**. A missing, malformed, or wrong-typed `config.json` degrades gracefully to
defaults (a warning is logged) — it never crashes the server. `config.json` itself is
**never served** (§3.2 → 404). Config is read **per request** (files are tiny) via
`loadDomainConfig()` in `src/domainConfig.ts`, then merged with the global env `Config`
into an `EffectiveConfig` for that request; a cache can slot in behind that seam later.

---

## 5. Rendering (self-contained, no external hosts)

**No Dave assets, no Bootstrap, no jQuery, no frameworks.** All styling is our own
**hand-written custom CSS, inlined** into the templates; all interactivity is our own
**lightweight vanilla JS**, inlined. No React/Vue/etc.

We default to custom CSS rather than Tailwind: a Tailwind CDN build would be an external
dependency (ruled out), and a Tailwind *build* step is unjustified tooling for three
small templates. If the template surface ever grows enough to warrant it, we can add a
Tailwind build that compiles to a static CSS file we inline — but not now.

### 5.1 OPML → HTML

- Parse OPML with **`fast-xml-parser`** (zero-dependency, well maintained).
- Emit a collapsible/expandable nested outline (`<ul>`/`<li>` with `<details>` or a
  tiny inline expand/collapse script).
- Read `<head>` metadata (`title`, `dateModified`, etc.) for the page title / header.
- Handle common attributes: `text`, `type="link"`/`url` → hyperlinks,
  `type="rss"` → feed links, nested `<outline>` children.
- All CSS/JS **inline** in the template — no CDN, no `scripting.com`.
- Gracefully handle malformed OPML → 500 with a plain-text message (don't crash;
  Dave had repeated crash bugs here).

### 5.2 Markdown → HTML

- Render with **`marked`** (current version) — or `markdown-it` if we want plugins.
- Extract the first `# H1` as the page `<title>`, else fall back to the file name
  (mirrors current behavior).
- Wrap in a self-contained template with inline GitHub-ish CSS. No `fargo.io` assets.

### 5.3 Templates

- Ship default OPML + Markdown + 404 templates as local files/strings with inline
  styling. Simple `[%token%]`-style or template-literal substitution.
- Per-domain override via `config.json` (§4), optional.

---

## 6. Tech stack & project structure

**Stack:** Node 20+, TypeScript, Hono (`hono` + `@hono/node-server`), `fast-xml-parser`,
`marked`, `mime-types`. Dev: `vitest`, `tsx`, `typescript`, `@types/*`.

```
outpost/
├── src/
│   ├── index.ts            # entry: load config, start @hono/node-server
│   ├── app.ts              # Hono app: /healthz, catch-all host+path handler
│   ├── config.ts           # env config + per-domain config.json loader
│   ├── domains.ts          # host → domain folder resolution (exact/wildcard/default)
│   ├── resolve.ts          # path → file resolution, security checks, index/dir logic
│   ├── serve.ts            # read/stream file, set MIME, dispatch to renderers
│   ├── render/
│   │   ├── markdown.ts
│   │   ├── opml.ts
│   │   └── templates.ts    # default templates + substitution
│   └── mime.ts             # extension → content type
├── domains/                # (gitignored / volume) per-domain content folders
│   └── default/
├── test/                   # vitest specs + fixtures (sample domains)
├── Dockerfile
├── .dockerignore
├── package.json
├── tsconfig.json
└── README.md               # rewritten for the modern app
```

Legacy files (`pagepark.js`, `cli/`, `prefs/`, `templates/`, `source.opml`, old `docs/`,
`worknotes.md`) have been **removed** (milestone 8) now that parity is reached. Default
OPML/Markdown/404 templates are inlined as TS strings in `src/render/templates.ts`
(compiled into `dist/`), so there is no runtime `templates/` directory.

---

## 7. Configuration (env vars)

- `OUTPOST_DOMAINS_DIR` — path to the domains root. Default `./domains`.
- `PORT` — HTTP port. Default `3000` (Caddy `reverse_proxy` targets this).
- `HOST` — bind address. Default `127.0.0.1` (reachable only via the proxy). Set
  `0.0.0.0` inside Docker and publish as `127.0.0.1:PORT:PORT`.
- `OUTPOST_DEFAULT_DOMAIN` — fallback folder name. Default `default`.
- `OUTPOST_INDEX_FILENAME` — base name (no extension) of a directory's index file.
  Default `index`. (Per-domain `config.json` override is milestone 5.)
- `OUTPOST_DEFAULT_TYPE` — Content-Type for extension-less files. Default `text/html`.
- `TRUST_FORWARDED_HEADERS` — trust `X-Forwarded-Host` as a fallback when `Host` is
  absent/rewritten. Default `on` (safe because we only listen on `127.0.0.1` behind the
  proxy; set `off` if Outpost is ever exposed directly).

These are the complete set actually read by `src/config.ts`. (An earlier draft listed
`LOG_LEVEL`; it is not read by the code, so it has been dropped to keep §7 in sync.)

No TLS in-app — Caddy terminates HTTPS and reverse-proxies to `localhost:PORT`.

---

## 8. Deployment (Docker + Dockge + Caddy)

- **Dockerfile:** multi-stage — build TS → run compiled JS on a slim Node base
  (`node:20-slim` or distroless). Non-root user. `EXPOSE` the port.
- **Volume:** mount the host's domains directory to `OUTPOST_DOMAINS_DIR` so content
  is edited outside the container and persists across deploys.
- **Compose (for Dockge):** service exposing `127.0.0.1:PORT:PORT`, the domains volume,
  and env vars. Caddy on the host does `reverse_proxy localhost:PORT` and handles TLS +
  virtual hosts. Caddy already knows the real domains and **forwards the original `Host`
  header by default** (plus `X-Forwarded-Host`), which is exactly what Outpost routes on
  — no extra proxy config needed. Binding to `127.0.0.1` (not `0.0.0.0`) keeps the app
  reachable only through Caddy, which is what makes trusting the forwarded headers safe.
- Include a sample `Caddyfile` snippet and `compose.yaml` in the README.

---

## 9. Testing

Use **vitest** with fixture domain folders under `test/fixtures/domains/`:

- Domain resolution: exact, wildcard (`*.b.c`), default fallback, unknown host.
- Path security: `../` traversal blocked, `_hidden` / dotfiles → 404, `config.json`
  not served.
- Directory handling: trailing-slash redirect, index file discovery, no-index → 404.
- Extension processing: `.html` as-is, image MIME, `.md` renders, `.js` served (not run).
- OPML: renders to HTML; `?format=opml` and `Accept: text/x-opml` serve raw XML;
  malformed OPML → 500 (no crash).
- Markdown: H1 → title; body renders.
- `/healthz` returns ok.

---

## 10. Milestones (chip away in this order)

1. ✅ **Scaffold** — `package.json`, `tsconfig`, Hono + node-server, `/healthz` + `/version`,
   `src/{index,app,config}.ts`. Dev (`tsx watch`) and prod (`tsc` → `node dist/`) both run;
   prod deps have 0 vulnerabilities. Config env vars wired: `PORT`, `HOST` (default
   `127.0.0.1`), `OUTPOST_DOMAINS_DIR`, `OUTPOST_DEFAULT_DOMAIN`, `TRUST_FORWARDED_HEADERS`.
2. ✅ **Domain resolution + static serving** — host→folder, path resolution, security
   checks, MIME, directory/index handling, 404. (This is the MVP: HTML + images work.)
3. ✅ **Markdown rendering** — `marked` + self-contained template + title extraction.
4. ✅ **OPML rendering** — `fast-xml-parser` + collapsible outline template + raw-OPML
   negotiation.
5. ✅ **Per-domain `config.json`** — minimal whitelist loader (`indexFilename`,
   `defaultType`, `defaultExtension`, `siteTitle`; unknown keys ignored; malformed
   → defaults, never crashes; `config.json` still 404). Loaded per request in
   `src/domainConfig.ts`, merged into an `EffectiveConfig` threaded through
   resolve → serve → renderers.
6. ✅ **Tests** — vitest suite per §9 (120 tests). Full §9 coverage incl. security
   hardening (encoded/backslash/null-byte traversal, case-insensitive `config.json`
   guard), host edge cases (forwarded-header trust on/off, missing default folder),
   and `/healthz` + `/version`.
7. ✅ **Docker + deploy** — multi-stage `Dockerfile` (build TS → run compiled JS on
   `node:22-slim`, prod deps only, non-root `node` user, `HOST=0.0.0.0`, `/healthz`
   HEALTHCHECK via Node `fetch`), `.dockerignore`, Dockge-friendly `compose.yaml`
   (`127.0.0.1:3000:3000`, domains volume, env in sync with `src/config.ts`),
   sample `Caddyfile`, README rewrite. `templates/` is NOT shipped — renderers inline
   templates as TS strings compiled into `dist/`.
8. ✅ **Cleanup** — deleted the legacy reference implementation (`pagepark.js`, `cli/`,
   `prefs/`, `templates/`, `docs/`, `source.opml`, `worknotes.md`); ran the final
   dependency audit. Confirmed: none of the banned Dave/deprecated packages are present
   in `package.json` or the lockfile; the dep tree is exactly `hono`, `@hono/node-server`,
   `mime-types`, `marked`, `fast-xml-parser` (+ devDeps `typescript`, `tsx`, `vitest`,
   `@types/node`, `@types/mime-types`); `pnpm audit --prod` reports 0 vulnerabilities;
   `src/` has no `child_process`/`exec`/`spawn`/`eval`/external-host calls. App still
   builds, all 120 tests pass, and `node dist/index.js` serves `/healthz`.

---

## 11. Open items / notes

- Confirm a starter set of `domains/` fixtures to validate against (port `source.opml`
  into a test fixture as a real-world OPML sample).
- Decide whether to keep `/version` and what it reports.
- Large binary files should be **streamed** (`createReadStream` → Response body) rather
  than fully buffered, and should send `Content-Length` / support conditional GETs
  (ETag / `Last-Modified`) if we want efficient static serving. Nice-to-have after MVP.
