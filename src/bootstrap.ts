import { mkdirSync, statSync } from "node:fs";
import type { Config } from "./config.js";

/** Outcome of an {@link ensureDomainsDir} call, returned mainly for logging/tests. */
export interface BootstrapResult {
  /** True when the domains root did not exist and was created. */
  created: boolean;
  /** Absolute path of the domains root that was targeted. */
  to: string;
}

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Ensure the domains root directory exists. On first run — a missing
 * `config.domainsDir`, such as a freshly mounted Docker volume — the directory
 * is created empty. Nothing is seeded into it: the shipped
 * `domains.example/default` template acts as the final cascade fallback
 * elsewhere. An already-existing domains root (empty or populated) is left
 * untouched.
 */
export function ensureDomainsDir(config: Config): BootstrapResult {
  const to = config.domainsDir;

  if (dirExists(to)) return { created: false, to };

  mkdirSync(to, { recursive: true });
  return { created: true, to };
}
