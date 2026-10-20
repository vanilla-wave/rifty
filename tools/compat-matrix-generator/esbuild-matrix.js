import { readFile } from 'node:fs/promises';
const here = new URL('.', import.meta.url);
const esbuildPolicyUrl = new URL('../shadow-registry/esbuild-runtime-policy.json', here);

function policyRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`esbuild runtime policy: ${label} must be an object`);
  }
  return value;
}

function policyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`esbuild runtime policy: ${label} must be a non-empty string`);
  }
  return value;
}

function policyArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`esbuild runtime policy: ${label} must be an array`);
  }
  return value;
}

function buildEsbuildMatrix(policyValue, verified) {
  const policy = policyRecord(policyValue, 'root');
  if (policy.schema !== 1) throw new Error('esbuild runtime policy: schema must be 1');
  if (policy.state !== 'contract-red' && policy.state !== 'final-green') {
    throw new Error('esbuild runtime policy: state must be contract-red or final-green');
  }
  const finalGreen = policy.state === 'final-green';
  const version = policyString(policy.version, 'version');
  const consumer = policyRecord(policy.consumer, 'consumer');
  const consumerPackage = policyString(consumer.package, 'consumer.package');
  const consumerVersion = policyString(consumer.version, 'consumer.version');
  const source = policyRecord(policy.source, 'source');
  const sourcePackage = policyString(source.package, 'source.package');
  const sourceMember = policyString(source.member, 'source.member');
  const sourceSha256 = policyString(source.sha256, 'source.sha256');
  const wasm = policyRecord(policy.wasm, 'wasm');
  const wasmMember = policyString(wasm.member, 'wasm.member');
  const wasmSha256 = policyString(wasm.sha256, 'wasm.sha256');
  for (const [label, digest] of [
    ['source.sha256', sourceSha256],
    ['wasm.sha256', wasmSha256],
  ]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`esbuild runtime policy: ${label} must be a SHA-256 hex digest`);
    }
  }

  const patches = policyArray(policy.patches, 'patches').map((value, index) =>
    policyString(value, `patches[${index}]`),
  );
  if (patches.length !== 13 || new Set(patches).size !== patches.length) {
    throw new Error('esbuild runtime policy: patches must contain 13 unique ordered ids');
  }
  const patchDescriptions = policyRecord(policy.patchDescriptions, 'patchDescriptions');
  const patchPlan = patches
    .map((id, index) => {
      const description = policyString(patchDescriptions[id], `patchDescriptions.${id}`);
      return `${index + 1}. \`${id}\` — ${description}`;
    })
    .join('<br>');

  const currentSurfaces = policyArray(policy.currentSurfaces, 'currentSurfaces').map(
    (value, index) => {
      const entry = policyRecord(value, `currentSurfaces[${index}]`);
      if (entry.status !== 'partial' && entry.status !== 'implemented') {
        throw new Error(
          `esbuild runtime policy: currentSurfaces[${index}].status must be partial or implemented`,
        );
      }
      // Exact-version twin: implemented and partial both read ⚠️ (AGENTS.md §Fidelity).
      return [
        policyString(entry.surface, `currentSurfaces[${index}].surface`),
        '⚠️',
        policyString(entry.notes, `currentSurfaces[${index}].notes`),
      ];
    },
  );
  const unsupportedSurfaces = policyArray(policy.unsupportedSurfaces, 'unsupportedSurfaces').map(
    (value, index) => {
      const entry = policyRecord(value, `unsupportedSurfaces[${index}]`);
      return [
        policyString(entry.surface, `unsupportedSurfaces[${index}].surface`),
        '❌',
        policyString(entry.notes, `unsupportedSurfaces[${index}].notes`),
      ];
    },
  );

  const gaps = policyArray(policy.gaps, 'gaps').map((value, index) => {
    const entry = policyRecord(value, `gaps[${index}]`);
    return {
      surface: policyString(entry.surface, `gaps[${index}].surface`),
      feature: policyString(entry.feature, `gaps[${index}].feature`),
      required: policyString(entry.required, `gaps[${index}].required`),
      current: policyString(entry.current, `gaps[${index}].current`),
    };
  });
  if (gaps.length !== 10 || new Set(gaps.map((gap) => gap.feature)).size !== gaps.length) {
    throw new Error('esbuild runtime policy: gaps must contain the 10 unique ADR-0226 D4 names');
  }

  const tests = policyArray(policy.tests, 'tests').map(
    (value, index) => `\`${policyString(value, `tests[${index}]`)}\``,
  );
  const limitations = policyArray(policy.limitations, 'limitations').map((value, index) =>
    policyString(value, `limitations[${index}]`),
  );

  return {
    file: 'esbuild-js-api.md',
    title: 'Compatibility matrix — esbuild JavaScript API',
    intro:
      `COI installs unmodified upstream esbuild-wasm for the requested esbuild range (ADR-0543). Verified against stock esbuild-wasm on Node 24: ${verified.join(', ')}. Other admitted versions: ⚠️ not verified. No generated client or esbuild patches load in COI. No-COI retains the following exact \`${sourcePackage}@${version}\` ` +
      `with \`${consumerPackage}@${consumerVersion}\` as an integration consumer; ${finalGreen ? 'Final+GREEN is browser-proven.' : 'Contract+RED is merged, Final+GREEN is not.'} ` +
      `Every no-COI API row is an exact-version ceiling (⚠️): a request the \`esbuild@${version}\` recipe does not admit is refused at install.`,
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
        'No-COI generated runtime',
        '⚠️',
        'Platform-gap debt until epics/no-coi-child-processes. Ranges admitting 0.28.0 retain 0.28.0; incompatible requests or pins fail by name with no-COI, never silently downpin.',
      ],
      [
        'No-COI exact source and WASM provenance',
        '✅',
        `Pinned and test-verified \`${sourceMember}\` SHA-256 \`${sourceSha256}\` and \`${wasmMember}\` SHA-256 \`${wasmSha256}\`; generated output and manifest are drift-gated.`,
      ],
      ['No-COI ordered generated patch plan', finalGreen ? '✅' : '⚠️', patchPlan],
      ...currentSurfaces.map(([surface, status, notes]) => [`No-COI ${surface}`, status, notes]),
      ...unsupportedSurfaces.map(([surface, status, notes]) => [
        `No-COI ${surface}`,
        status,
        notes,
      ]),
      ...gaps.map((gap) => [
        `No-COI D4 gap: \`${gap.surface}\``,
        '❌',
        `Required outcome: ${gap.required} ${gap.current}`,
      ]),
    ],
    tests: [
      '`tests/browser-unit/esbuild-upstream-twin.spec.ts`',
      '`tests/browser-unit/esbuild-upstream-host.spec.ts`',
      '`tests/browser-unit/esbuild-vite-contract.spec.ts`',
      ...tests,
    ],
    limitations: [
      'COI: esbuild-wasm on Node 24 is the oracle; native-esbuild differences remain visible. A verified version adds only its list entry and upstream archive; the same differential runs in browser-unit CI.',
      ...limitations.map((line) => `No-COI: ${line}`),
    ],
  };
}

const esbuildPolicy = JSON.parse(await readFile(esbuildPolicyUrl, 'utf8'));
const esbuildVerified = JSON.parse(
  await readFile(new URL('../shadow-registry/esbuild-upstream-verified.json', here), 'utf8'),
);
export const esbuildMatrix = buildEsbuildMatrix(esbuildPolicy, esbuildVerified);
