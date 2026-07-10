import { realpathSync, statSync, type Stats } from "node:fs";
import { join, resolve as resolvePathAbs, sep } from "node:path";
import type { Config } from "./config.js";

/** Outcome of resolving a URL path within a domain folder (§3.2). */
export type ResolveResult =
  | { kind: "file"; path: string }
  | { kind: "redirect"; location: string }
  | { kind: "notFound" };

/** Never serve a domain's config.json (§3.2). */
const NEVER_SERVE = "config.json";

/**
 * Extensions tried, in order, when looking for a directory index file. The first
 * `<indexFilename>.<ext>` that exists as a regular file is served (§3.2).
 */
const INDEX_EXTENSIONS = ["html", "htm", "md", "opml", "txt", "js"];

function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Resolve a request path to a file / redirect / 404 within `domainFolder`.
 *
 * `rawPath` is the request pathname exactly as received (may be percent-encoded
 * and may or may not end in a trailing slash). Security per §3.2:
 *   - reject `..` traversal (including encoded) and any path that escapes the folder,
 *   - reject any segment starting with `_` or `.` (hidden) → 404,
 *   - never serve `config.json` → 404.
 */
export function resolvePath(
  domainFolder: string,
  rawPath: string,
  config: Config,
): ResolveResult {
  const hasTrailingSlash = rawPath.endsWith("/");

  // Split on "/" and decode each segment individually so that an encoded slash
  // (%2F) can never introduce a new path separator.
  const rawSegments = rawPath.split("/");
  const segments: string[] = [];
  for (const raw of rawSegments) {
    if (raw === "") continue; // leading/trailing/double slashes
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return { kind: "notFound" }; // malformed percent-encoding
    }
    // Decoding could still yield a separator or empty; treat those as invalid.
    if (seg === "" || seg.includes("/") || seg.includes("\\")) {
      return { kind: "notFound" };
    }
    // Hidden segments (covers "." and ".." as well as dotfiles / underscore dirs).
    if (seg.startsWith("_") || seg.startsWith(".")) {
      return { kind: "notFound" };
    }
    // Case-insensitive so config.json can't be leaked via a case-variant
    // request (e.g. /Config.json) on a case-insensitive filesystem.
    if (seg.toLowerCase() === NEVER_SERVE) {
      return { kind: "notFound" };
    }
    segments.push(seg);
  }

  const candidate = join(domainFolder, ...segments);

  // Defense in depth: the resolved absolute path must stay inside the domain folder.
  const folderAbs = resolvePathAbs(domainFolder);
  const candidateAbs = resolvePathAbs(candidate);
  if (candidateAbs !== folderAbs && !candidateAbs.startsWith(folderAbs + sep)) {
    return { kind: "notFound" };
  }

  const st = statOrNull(candidate);
  if (st === null) {
    return { kind: "notFound" };
  }

  if (st.isDirectory()) {
    if (!hasTrailingSlash) {
      // Build the redirect target from the decoded segments; app.ts re-attaches query.
      const location = "/" + [...segments, ""].join("/");
      return { kind: "redirect", location };
    }
    return resolveIndex(candidate, folderAbs, config);
  }

  if (!st.isFile()) {
    return { kind: "notFound" };
  }

  // Guard against symlink escape: the real path must still be inside the folder.
  if (!isInside(candidate, folderAbs)) {
    return { kind: "notFound" };
  }

  return { kind: "file", path: candidate };
}

/** Look for `<indexFilename>.<ext>` in a directory and serve the first match. */
function resolveIndex(
  dir: string,
  folderAbs: string,
  config: Config,
): ResolveResult {
  for (const ext of INDEX_EXTENSIONS) {
    const candidate = join(dir, `${config.indexFilename}.${ext}`);
    const st = statOrNull(candidate);
    if (st?.isFile() && isInside(candidate, folderAbs)) {
      return { kind: "file", path: candidate };
    }
  }
  return { kind: "notFound" };
}

/**
 * True when `path`'s real location is the domain folder or lives beneath it.
 * Both sides are resolved through `realpathSync` so a symlinked domains root
 * (e.g. macOS `/tmp` → `/private/tmp`) doesn't produce false negatives, while a
 * symlink pointing *out* of the folder is still rejected.
 */
function isInside(path: string, folderAbs: string): boolean {
  let real: string;
  let folderReal: string;
  try {
    real = realpathSync(path);
    folderReal = realpathSync(folderAbs);
  } catch {
    return false;
  }
  return real === folderReal || real.startsWith(folderReal + sep);
}
