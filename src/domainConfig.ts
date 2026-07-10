import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";

/**
 * Per-domain overrides read from an optional `config.json` at the root of a
 * domain folder (§4). Every field is optional; unknown keys in the file are
 * ignored (whitelist approach). This type is deliberately distinct from the
 * global env `Config` so the two stay composable via {@link effectiveConfig}.
 */
export interface DomainConfig {
  /** Base name (no extension) of a directory's index file. */
  indexFilename?: string;
  /** Content-Type for extension-less files. */
  defaultType?: string;
  /** Treat an extension-less file as if it had this extension (e.g. "md"). */
  defaultExtension?: string;
  /** Fallback page title for the Markdown/OPML wrappers when the document has none. */
  siteTitle?: string;
}

/**
 * The global {@link Config} overlaid with a request's per-domain overrides.
 * It IS a `Config` (so it threads through `resolve`/`serve` unchanged) plus the
 * two domain-only fields the renderers/dispatch consult.
 */
export interface EffectiveConfig extends Config {
  defaultExtension?: string;
  siteTitle?: string;
}

/** The domain config file name; never served to clients (§3.2). */
const CONFIG_FILENAME = "config.json";

/**
 * Read and validate a domain folder's optional `config.json` (§4).
 *
 * Safe by construction: only known keys are read (unknown keys ignored), and a
 * missing / malformed / wrong-typed file never throws — it degrades to `{}` so
 * defaults apply. No redirects, no remote fetching, no code eval. Read per
 * request (files are tiny); a cache can be added later behind this seam.
 */
export function loadDomainConfig(domainFolder: string): DomainConfig {
  let raw: string;
  try {
    raw = readFileSync(join(domainFolder, CONFIG_FILENAME), "utf8");
  } catch {
    // No config.json (or unreadable) — defaults apply. Not worth a warning.
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `Outpost: ignoring malformed config.json in ${domainFolder} (invalid JSON)`,
    );
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(
      `Outpost: ignoring config.json in ${domainFolder} (not a JSON object)`,
    );
    return {};
  }

  const obj = parsed as Record<string, unknown>;
  const config: DomainConfig = {};

  const indexFilename = readString(obj.indexFilename);
  if (indexFilename !== undefined) config.indexFilename = indexFilename;

  const defaultType = readString(obj.defaultType);
  if (defaultType !== undefined) config.defaultType = defaultType;

  const defaultExtension = readString(obj.defaultExtension);
  if (defaultExtension !== undefined) {
    // Store without a leading dot; the dispatcher re-attaches one.
    config.defaultExtension = defaultExtension.replace(/^\.+/, "").toLowerCase();
  }

  const siteTitle = readString(obj.siteTitle);
  if (siteTitle !== undefined) config.siteTitle = siteTitle;

  return config;
}

/**
 * Merge a cascade of domain roots into a single {@link DomainConfig} (§4).
 *
 * `roots` is ordered most-specific-first (index 0 is the exact domain folder;
 * later entries are fallbacks such as the default / example-default roots).
 * Each root's `config.json` is read via {@link loadDomainConfig} — which yields
 * only the keys actually present — then merged so the most-specific root wins
 * per key. We walk from the last (least-specific) root forward, `Object.assign`-
 * ing onto an accumulator, so earlier roots overwrite later ones and a root
 * whose file is missing/malformed (an empty config) contributes nothing.
 */
export function loadDomainConfigCascade(roots: string[]): DomainConfig {
  const merged: DomainConfig = {};
  for (let i = roots.length - 1; i >= 0; i--) {
    const root = roots[i];
    if (root === undefined) continue;
    Object.assign(merged, loadDomainConfig(root));
  }
  return merged;
}

/**
 * Merge per-domain overrides onto the global config for a single request.
 * Returns a fresh object (never mutates the global config). Domain values win
 * where present; otherwise the global defaults stand.
 */
export function effectiveConfig(
  config: Config,
  domain: DomainConfig,
): EffectiveConfig {
  const eff: EffectiveConfig = {
    ...config,
    indexFilename: domain.indexFilename ?? config.indexFilename,
    defaultType: domain.defaultType ?? config.defaultType,
  };
  if (domain.defaultExtension !== undefined) {
    eff.defaultExtension = domain.defaultExtension;
  }
  if (domain.siteTitle !== undefined) {
    eff.siteTitle = domain.siteTitle;
  }
  return eff;
}

/** Accept only non-empty strings; anything else (wrong type) is ignored. */
function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
