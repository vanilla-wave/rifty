import { DEFAULT_PREVIEW_PREFIX, normalizePreviewPrefix } from '@riftydev/io';

const PREVIEW_PREFIX_QUERY = '__rifty_preview_prefix';

function configuredPrefixFields(url: string): string[] {
  return new URL(url).search
    .slice(1)
    .split('&')
    .filter((field) => {
      const key = field.split('=', 1)[0]!;
      try {
        return decodeURIComponent(key.replace(/\+/g, ' ')) === PREVIEW_PREFIX_QUERY;
      } catch {
        return false; // Malformed opaque keys cannot equal the reserved ASCII key.
      }
    });
}

/** Append static SW configuration without reserializing the host's opaque query. */
export function configurePreviewServiceWorkerUrl(url: string, previewPrefix?: string): string {
  if (previewPrefix === undefined) return url;
  const prefix = normalizePreviewPrefix(previewPrefix);
  if (configuredPrefixFields(url).length !== 0) {
    throw new TypeError(`Service Worker URL already contains ${PREVIEW_PREFIX_QUERY}`);
  }
  const hash = url.indexOf('#');
  const script = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash);
  const delimiter = script.includes('?') ? '&' : '?';
  return `${script}${delimiter}${PREVIEW_PREFIX_QUERY}=${encodeURIComponent(prefix)}${fragment}`;
}

/** Capture once from the SW's own location; absence keeps the legacy route. */
export function previewPrefixFromServiceWorkerUrl(url: string): string {
  const fields = configuredPrefixFields(url);
  if (fields.length === 0) return DEFAULT_PREVIEW_PREFIX;
  if (fields.length !== 1) throw new TypeError(`Duplicate ${PREVIEW_PREFIX_QUERY}`);
  const field = fields[0]!;
  const equals = field.indexOf('=');
  const value = equals === -1 ? '' : field.slice(equals + 1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw new TypeError(`Malformed ${PREVIEW_PREFIX_QUERY}`);
  }
  return normalizePreviewPrefix(decoded);
}
