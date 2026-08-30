/**
 * Header provenance via ACTUAL consumed responses (provenance-lie killer):
 * an in-page re-fetch sweep observes its OWN requests, not the navigation /
 * Worker-script / module responses the realm consumed — a server keying
 * isolation headers on request destination (`Sec-Fetch-Dest`) serves them on
 * the real responses while every ordinary fetch stays clean. Capture the
 * responses the browser actually consumed (Playwright response events) and
 * fail loud on ANY isolation header or ANY expected class never consumed.
 * One authority for the substrate spec AND the replay driver;
 * `header-provenance.no-coi.spec.ts` pins detection with per-class
 * destination-conditional injection.
 */

/** Response classes the substrate consumes, by pathname. */
export const CONSUMED_CLASSES = {
  page: {
    document: '/index.html',
    probeModule: '/probe-lib.mjs',
    builtShim: '/dist/worker-realm-compat.mjs',
    builtUtilTypes: '/dist/util-types.mjs',
  },
  worker: {
    document: '/index.html',
    workerScript: '/probe-worker.mjs',
    probeModule: '/probe-lib.mjs',
    builtShim: '/dist/worker-realm-compat.mjs',
    builtUtilTypes: '/dist/util-types.mjs',
  },
};

/** Attach BEFORE navigation; records every response the page (incl. its
 * dedicated workers) actually consumes. */
export function captureConsumedResponses(page) {
  const responses = [];
  page.on('response', (response) => {
    const headers = response.headers();
    responses.push({
      pathname: new URL(response.url()).pathname,
      status: response.status(),
      coop: headers['cross-origin-opener-policy'] ?? null,
      coep: headers['cross-origin-embedder-policy'] ?? null,
    });
  });
  return responses;
}

/** Per-class record of the consumed response (transcript/assertion shape). */
export function summarizeConsumedResponses(responses, classes) {
  const out = {};
  for (const [name, pathname] of Object.entries(classes)) {
    const hit = responses.find((r) => r.pathname === pathname);
    out[name] = hit === undefined ? null : { status: hit.status, coop: hit.coop, coep: hit.coep };
  }
  return out;
}

/** Throws unless BOTH isolation headers are absent on EVERY consumed response
 * AND every expected class was actually consumed (status 200). */
export function assertHeaderlessConsumption(responses, classes) {
  for (const r of responses) {
    if (r.coop !== null || r.coep !== null) {
      throw new Error(
        `no-COI substrate CONSUMED an isolation header: ${r.pathname} ` +
          `coop=${String(r.coop)} coep=${String(r.coep)}`,
      );
    }
  }
  for (const [name, pathname] of Object.entries(classes)) {
    if (!responses.some((r) => r.pathname === pathname && r.status === 200)) {
      throw new Error(
        `no-COI substrate never consumed ${name} (${pathname}) — header provenance unproven`,
      );
    }
  }
}
