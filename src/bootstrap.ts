import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";

/**
 * Directory shipped in the repo (and Docker image) that seeds a fresh domains
 * root. Resolved relative to this module so it works both in dev (`src/`) and
 * in the compiled build (`dist/`): in either case it sits one level up.
 */
const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "domains.example");

/** Outcome of an {@link ensureDomainsDir} call, returned mainly for logging/tests. */
export interface BootstrapResult {
  /** True when the example content was copied into the domains root. */
  seeded: boolean;
  /** Absolute path of the seed source (present only when seeding occurred). */
  from?: string;
  /** Absolute path of the domains root that was targeted. */
  to: string;
}

/** True when `path` is a directory with at least one entry. */
function isNonEmptyDir(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Ensure the domains root exists and has content. On first run — a missing or
 * empty `config.domainsDir`, such as a freshly mounted Docker volume — the
 * `domains.example/` template is copied in so the server has something to serve.
 * An already-populated domains root is left untouched.
 *
 * @param source Override the seed directory (used by tests).
 */
export function ensureDomainsDir(
  config: Config,
  source: string = exampleDir,
): BootstrapResult {
  const to = config.domainsDir;

  // Already provisioned — never overwrite a user's content.
  if (isNonEmptyDir(to)) return { seeded: false, to };

  // Nothing to seed from; let the app run and 404 until content shows up.
  if (!dirExists(source)) return { seeded: false, to };

  mkdirSync(to, { recursive: true });
  cpSync(source, to, { recursive: true });
  return { seeded: true, from: source, to };
}
