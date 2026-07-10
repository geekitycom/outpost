import mime from "mime-types";
import { extname } from "node:path";

/**
 * Derive a Content-Type for a file from its extension via `mime-types`.
 *
 * - Files with no recognizable extension (or an unknown one) get `defaultType`
 *   (§3.3: extension-less → configurable default, default `text/html`).
 * - `.js` resolves to `text/javascript`; it is always served as a static file,
 *   never executed (the caller never runs `.js` — this module only labels it).
 *
 * `mime.contentType` appends `; charset=utf-8` for text types, which is desirable
 * for HTML/CSS/JS. For binary types (images) it returns just the type. We resolve
 * from the extension only — `mime.contentType` treats a value containing `/`
 * (e.g. an absolute path) as an already-formed content type and echoes it back.
 */
export function contentTypeFor(filename: string, defaultType: string): string {
  return contentTypeForExtension(extname(filename), defaultType);
}

/**
 * Like {@link contentTypeFor} but takes an already-extracted extension (e.g.
 * `".md"`, or `""`). Used when a per-domain `defaultExtension` makes serve.ts
 * treat an extension-less file as if it had a specific extension (§4).
 */
export function contentTypeForExtension(
  ext: string,
  defaultType: string,
): string {
  if (ext === "") return defaultType;
  const type = mime.contentType(ext);
  return type === false ? defaultType : type;
}
