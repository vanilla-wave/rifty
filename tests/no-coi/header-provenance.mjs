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

/** Response classes the substrate consumes, by pathname. `kernelDriver` is the
 * evidence driver's kernel-sweep page (probe row 12) — ONE authority for every
 * sibling caller of {@link assertHeaderlessConsumption}. */
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
  kernelDriver: {
    document: '/index.html',
    kernelPublic: '/dist/kernel-public.mjs',
    kernelStdioDrain: '/dist/kernel-stdio-drain.mjs',
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
 * AND every expected class was actually consumed with status 200. The absent
 * and non-200 arms throw DISTINCT messages — each arm carries its own
 * detection pin (`header-provenance.no-coi.spec.ts`); a headerless sweep alone
 * proves nothing about classes the realm never (successfully) loaded. */
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
    const hits = responses.filter((r) => r.pathname === pathname);
    if (hits.length === 0) {
      throw new Error(
        `no-COI substrate never consumed ${name} (${pathname}) — header provenance unproven`,
      );
    }
    if (!hits.some((r) => r.status === 200)) {
      throw new Error(
        `no-COI substrate consumed ${name} (${pathname}) only non-200 ` +
          `(status ${hits.map((r) => r.status).join(',')}) — header provenance unproven`,
      );
    }
  }
}
