import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Runtime configuration, resolved from environment variables at startup. */
export interface Config {
  /** HTTP port to listen on. */
  port: number;
  /** Bind address. Defaults to 127.0.0.1 so the app is only reachable via the reverse proxy. */
  host: string;
  /** Absolute path to the domains root directory. */
  domainsDir: string;
  /** Folder name used when no domain (or wildcard) folder matches. */
  defaultDomain: string;
  /** Directory holding the shipped example/default content — the final cascade fallback before a 404. */
  exampleDir?: string;
  /** Trust X-Forwarded-Host as a fallback when the Host header is absent/rewritten. */
  trustForwardedHeaders: boolean;
  /** Base name (without extension) of the directory index file. Default "index". */
  indexFilename: string;
  /** Content-Type served for extension-less files. Default "text/html". */
  defaultType: string;
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  return {
    port,
    host: env.HOST ?? "127.0.0.1",
    domainsDir: resolve(env.OUTPOST_DOMAINS_DIR ?? "domains"),
    defaultDomain: env.OUTPOST_DEFAULT_DOMAIN ?? "default",
    exampleDir: env.OUTPOST_EXAMPLE_DIR
      ? resolve(env.OUTPOST_EXAMPLE_DIR)
      : resolve(dirname(fileURLToPath(import.meta.url)), "..", "domains.example"),
    trustForwardedHeaders: envFlag(env.TRUST_FORWARDED_HEADERS, true),
    indexFilename: env.OUTPOST_INDEX_FILENAME ?? "index",
    defaultType: env.OUTPOST_DEFAULT_TYPE ?? "text/html",
  };
}
