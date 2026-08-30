/**
 * Header provenance via ACTUAL consumed responses (provenance-lie killer):
 * an in-page re-fetch sweep observes its OWN requests, not the navigation /
 * Worker-script / module responses the realm consumed — a server keying
 * isolation headers on request destination (`Sec-Fetch-Dest`) serves them on
 * the real responses while every ordinary fetch stays clean. Capture the
 * responses the browser actually consumed (Playwright response events), keyed
 * by pathname AND request destination — pathname alone is itself a provenance
 * lie: a missing or destination-only-404 real class followed by an ordinary
 * `fetch(path)` (destination `empty`, status 200) would pass. Fail loud on ANY
 * isolation header or ANY expected (path, dest) class never consumed with 200.
 * One authority for the substrate spec AND the replay driver;
 * `header-provenance.no-coi.spec.ts` pins detection (injection, absent,
 * destination-only-non-200 — each combined with a clean same-path fetch).
 */

/** Response classes the substrate consumes, keyed by pathname + request
 * destination (`Sec-Fetch-Dest`): navigation `document`, Worker main script
 * (and its STATIC imports, which inherit it) `worker`, dynamic `import()`
 * `script`; ordinary fetch is `empty` and never satisfies a class.
 * `kernelDriver` is the evidence driver's kernel-sweep page (probe row 12) —
 * ONE authority for every sibling caller of
 * {@link assertHeaderlessConsumption}. */
export const CONSUMED_CLASSES = {
  page: {
    document: { path: '/index.html', dest: 'document' },
    probeModule: { path: '/probe-lib.mjs', dest: 'script' },
    builtShim: { path: '/dist/worker-realm-compat.mjs', dest: 'script' },
    builtUtilTypes: { path: '/dist/util-types.mjs', dest: 'script' },
  },
  worker: {
    document: { path: '/index.html', dest: 'document' },
    workerScript: { path: '/probe-worker.mjs', dest: 'worker' },
    probeModule: { path: '/probe-lib.mjs', dest: 'worker' },
    builtShim: { path: '/dist/worker-realm-compat.mjs', dest: 'script' },
    builtUtilTypes: { path: '/dist/util-types.mjs', dest: 'script' },
  },
  kernelDriver: {
    document: { path: '/index.html', dest: 'document' },
    kernelPublic: { path: '/dist/kernel-public.mjs', dest: 'script' },
    kernelStdioDrain: { path: '/dist/kernel-stdio-drain.mjs', dest: 'script' },
  },
};

/** Attach BEFORE navigation; records every response the page (incl. its
 * dedicated workers) actually consumes. The destination rides the REQUEST's
 * browser-added `Sec-Fetch-Dest` header, only available asynchronously —
 * `settle()` awaits every pending record, then returns them. An unsettled
 * dest stays null and matches no class (loud absent throw, never a pass). */
export function captureConsumedResponses(page) {
  const responses = [];
  const pending = [];
  page.on('response', (response) => {
    const headers = response.headers();
    const record = {
      pathname: new URL(response.url()).pathname,
      status: response.status(),
      dest: null,
      coop: headers['cross-origin-opener-policy'] ?? null,
      coep: headers['cross-origin-embedder-policy'] ?? null,
    };
    responses.push(record);
    pending.push(
      response
        .request()
        .allHeaders()
        .then(
          (all) => {
            record.dest = all['sec-fetch-dest'] ?? null;
          },
          () => {}, // request context gone — dest stays null, class match fails loud
        ),
    );
  });
  return {
    async settle() {
      let settled = 0;
      while (settled < pending.length) {
        const batch = pending.slice(settled);
        settled = pending.length;
        await Promise.all(batch);
      }
      return responses;
    },
  };
}

/** Per-class record of the consumed response (transcript/assertion shape). */
export function summarizeConsumedResponses(responses, classes) {
  const out = {};
  for (const [name, cls] of Object.entries(classes)) {
    const hit = responses.find((r) => r.pathname === cls.path && r.dest === cls.dest);
    out[name] = hit === undefined ? null : { status: hit.status, coop: hit.coop, coep: hit.coep };
  }
  return out;
}

/** Throws unless BOTH isolation headers are absent on EVERY consumed response
 * AND every expected (path, dest) class was actually consumed with status 200.
 * The absent and non-200 arms throw DISTINCT exact messages — each arm carries
 * its own detection pin (`header-provenance.no-coi.spec.ts`); a headerless
 * sweep alone proves nothing about classes the realm never (successfully)
 * loaded, and a pathname-only match proves nothing about the DESTINATION that
 * consumed it (an ordinary fetch is not the navigation/Worker/module load). */
export function assertHeaderlessConsumption(responses, classes) {
  for (const r of responses) {
    if (r.coop !== null || r.coep !== null) {
      throw new Error(
        `no-COI substrate CONSUMED an isolation header: ${r.pathname} ` +
          `coop=${String(r.coop)} coep=${String(r.coep)}`,
      );
    }
  }
  for (const [name, cls] of Object.entries(classes)) {
    const hits = responses.filter((r) => r.pathname === cls.path && r.dest === cls.dest);
    if (hits.length === 0) {
      throw new Error(
        `no-COI substrate never consumed ${name} (${cls.path} as ${cls.dest}) — header provenance unproven`,
      );
    }
    if (!hits.some((r) => r.status === 200)) {
      throw new Error(
        `no-COI substrate consumed ${name} (${cls.path} as ${cls.dest}) only non-200 ` +
          `(status ${hits.map((r) => r.status).join(',')}) — header provenance unproven`,
      );
    }
  }
}
