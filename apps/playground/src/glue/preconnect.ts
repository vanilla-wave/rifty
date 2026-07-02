/**
 * `<link rel="preconnect" crossorigin>` for the configured registry + resolver
 * origins (ADR-0195): DNS+TCP+TLS leave the install critical path during page
 * boot instead of serializing into the first registry/eddy fetch. Origins come
 * from env-config only (D-004) — nothing configured → no tags. Idempotent per
 * origin; malformed URLs are skipped (a bad env value must not break boot).
 */

/** The narrow DOM slice this helper touches (playground unit tests run in a
 * DOM-less Node environment and pass a structural fake). */
export interface PreconnectDocument {
  readonly head: {
    querySelector(selectors: string): unknown;
    appendChild(node: unknown): unknown;
  };
  createElement(tagName: 'link'): {
    rel: string;
    href: string;
    crossOrigin: string | null;
  };
}

export function injectPreconnects(
  doc: PreconnectDocument,
  urls: ReadonlyArray<string | undefined>,
): void {
  const origins = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    try {
      origins.add(new URL(url).origin);
    } catch {
      // Malformed env URL — skip; the fetch path surfaces its own error.
    }
  }
  for (const origin of origins) {
    if (doc.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) continue;
    const link = doc.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    // The registry/eddy fetches are CORS no-credentials — the warmed
    // connection must match that mode or the browser opens a second one.
    link.crossOrigin = 'anonymous';
    doc.head.appendChild(link);
  }
}
