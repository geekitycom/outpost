import { join } from "node:path";
import type { Config } from "./config.js";

/**
 * Normalize a raw Host (or X-Forwarded-Host) header value into a bare hostname:
 * take the first value if comma-separated, strip any `:port` suffix, trim, and
 * lowercase. Returns undefined when there is nothing usable, or when the host
 * could enable path traversal once joined onto a filesystem path — it contains a
 * `/` or `\`, or has an empty label (e.g. `..`, `a..b`).
 */
export function normalizeHost(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // X-Forwarded-Host may be a comma-separated list; the first entry is the origin.
  const first = raw.split(",")[0] ?? "";
  // Strip a :port suffix. IPv6 literals aren't a concern for domain routing here.
  const host = first.trim().replace(/:\d+$/, "").toLowerCase();
  if (host.length === 0) return undefined;
  // Reject path separators and empty labels: domainSearchRoots joins the host
  // onto a filesystem path, so these could otherwise escape the domains root.
  if (host.includes("/") || host.includes("\\")) return undefined;
  if (host.split(".").some((label) => label.length === 0)) return undefined;
  return host;
}

/**
 * Build the ordered, de-duplicated list of candidate domain-folder paths for a
 * host — the cascade a caller walks (stat-ing each) before falling to a 404:
 *   1. `domainsDir/<host>` (exact).
 *   2. `domainsDir/*.<rest>` (wildcard: leftmost label replaced with `*`), for
 *      any host of 2+ labels (e.g. `opml.localhost` → `*.localhost`).
 *   3. `domainsDir/<defaultDomain>` (the local default fallback).
 *   4. `exampleDir/<defaultDomain>` (the shipped example default), when
 *      `config.exampleDir` is set — the final fallback before a 404.
 *
 * Later roots are shadowed by earlier ones; file, `config.json`, and template
 * lookups all walk this list so the most-specific root wins per key. Paths are
 * not guaranteed to exist; the caller is responsible for stat-ing them.
 */
export function domainSearchRoots(host: string, config: Config): string[] {
  const candidates: string[] = [];
  candidates.push(join(config.domainsDir, host));

  const labels = host.split(".");
  if (labels.length >= 2) {
    candidates.push(join(config.domainsDir, `*.${labels.slice(1).join(".")}`));
  }

  candidates.push(join(config.domainsDir, config.defaultDomain));
  if (config.exampleDir) {
    candidates.push(join(config.exampleDir, config.defaultDomain));
  }

  // De-duplicate by exact string equality, preserving first-seen order.
  return [...new Set(candidates)];
}
