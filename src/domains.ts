import { statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";

/**
 * Normalize a raw Host (or X-Forwarded-Host) header value into a bare hostname:
 * take the first value if comma-separated, strip any `:port` suffix, trim, and
 * lowercase. Returns undefined when there is nothing usable.
 */
export function normalizeHost(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // X-Forwarded-Host may be a comma-separated list; the first entry is the origin.
  const first = raw.split(",")[0] ?? "";
  // Strip a :port suffix. IPv6 literals aren't a concern for domain routing here.
  const host = first.trim().replace(/:\d+$/, "").toLowerCase();
  return host.length > 0 ? host : undefined;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a hostname to an absolute domain folder path per §3.1:
 *   1. `domains/<host>` if it exists.
 *   2. Otherwise, for a 3-label host `a.b.c`, `domains/*.b.c` if it exists.
 *   3. Otherwise, `domains/<defaultDomain>`.
 *
 * The returned path is not guaranteed to exist (the default folder may be absent);
 * callers handle a missing folder as a 404.
 */
export function resolveDomainFolder(host: string, config: Config): string {
  const exact = join(config.domainsDir, host);
  if (isDir(exact)) return exact;

  const labels = host.split(".");
  if (labels.length === 3) {
    const wildcard = join(config.domainsDir, `*.${labels[1]}.${labels[2]}`);
    if (isDir(wildcard)) return wildcard;
  }

  return join(config.domainsDir, config.defaultDomain);
}
