import { readFile } from 'node:fs/promises';
const here = new URL('.', import.meta.url);
function buildEsbuildMatrix(verified) {
  return {
    file: 'esbuild-js-api.md',
    title: 'Compatibility matrix — esbuild JavaScript API',
    intro: `COI installs unmodified upstream esbuild-wasm for the requested esbuild range (ADR-0543). Verified against stock esbuild-wasm on Node 24: ${verified.join(', ')}. Other admitted versions: ⚠️ not verified. No generated client or esbuild patches load in COI. No-COI uses the upstream 0.28.0 Node client through SW-backed children (ADR-0539); an active rifty SW is required. Exact admission remains a ceiling.`,
    rows: [
      [
        'COI upstream source / range admission',
        '✅',
        'Complete upstream tarball bytes retained; one thin name/types/bin facade, selected version unchanged. Other resolved versions are admitted without a verified-version allowlist.',
      ],
      [
        'COI async API and lifecycle',
        '✅',
        'Live Node differential: transform/diagnostics, build/metadata, plugins, contexts/rebuild/cancel/watch/dispose, initialize/stop/restart; CLI pipe, TTY and file output. The file-output quirk follows stock Node, not native esbuild.',
      ],
      [
        'COI context.serve',
        '⚠️',
        'Same upstream WebAssembly limitation/error as esbuild-wasm on Node; no independent native-esbuild serve claim.',
      ],
      [
        'COI Sync family',
        '⚠️',
        'Named NotImplementedError on both upstream routes: worker_threads.workerData.structuredClone or child_process.execFileSync. Stock startup can hit this capability gap before option validation; real Sync execution is not implemented.',
      ],
      [
        'No-COI upstream Node client',
        '⚠️',
        'Transform/build and fresh invocation parity are browser-proven at 0.28.0. Ranges admitting 0.28.0 retain that version; incompatible requests or pins fail by name with no-COI, never silently downpin. The generated client and its former D4 gates are absent from this execution path.',
      ],
    ],
    tests: [
      '`tests/browser-unit/esbuild-upstream-twin.spec.ts`',
      '`tests/browser-unit/esbuild-upstream-host.spec.ts`',
      '`tests/browser-unit/esbuild-vite-contract.spec.ts`',
      '`tests/no-coi/no-coi-esbuild-retirement.spec.ts`',
      '`tests/no-coi/no-coi-sandbox-build-loop.spec.ts`',
      '`tests/integration/no-coi-esbuild-graph-proof.mjs`',
    ],
    limitations: [
      'COI: esbuild-wasm on Node 24 is the oracle; native-esbuild differences remain visible. A verified version adds only its list entry and upstream archive; the same differential runs in browser-unit CI.',
      'No-COI: requires an active rifty SW. Only 0.28.0 transform/build is claimed here; the COI differential matrix is not a no-COI API claim.',
    ],
  };
}

const esbuildVerified = JSON.parse(
  await readFile(new URL('../shadow-registry/esbuild-upstream-verified.json', here), 'utf8'),
);
export const esbuildMatrix = buildEsbuildMatrix(esbuildVerified);
