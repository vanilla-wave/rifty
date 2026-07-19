import { toPlaygroundProjectPlan } from '../../../apps/playground/src/adapters/playground-project-plan.ts';
import {
  type PlaygroundProjectPlan,
  openPlaygroundWorkbench,
} from '../../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import { workbenchViteHostAssets } from '../../../apps/playground/src/browser-unit/workbench-vite-host-assets.ts';
import { starterFromPreset } from '../../../apps/playground/src/glue/starter.ts';
import { PRESETS } from '../../../apps/playground/src/presets.ts';

const GUEST_CAPABILITY_PROJECTION_PREFIX = 'RIFTY_VITE_GUEST_CAPABILITY_PROJECTION:';
const GUEST_CAPABILITY_PROBE_CONFIG = [
  "const capabilityGlobalKey = ['__riftyKernel', 'EntryCapability', 'Ports__'].join('');",
  'const ambientCapabilities = globalThis[capabilityGlobalKey];',
  'const projection = {',
  '  present: Object.getOwnPropertyNames(globalThis).includes(capabilityGlobalKey),',
  '  keys:',
  "    ambientCapabilities !== null && typeof ambientCapabilities === 'object'",
  '      ? Reflect.ownKeys(ambientCapabilities).map(String).sort()',
  '      : [],',
  '};',
  `console.log(${JSON.stringify(GUEST_CAPABILITY_PROJECTION_PREFIX)} + JSON.stringify(projection));`,
  'export default { optimizeDeps: { noDiscovery: true, include: [] } };',
  '',
].join('\n');

interface ColdViteCompanionProof {
  readonly plan: {
    readonly kind: PlaygroundProjectPlan['kind'];
    readonly materializationKind: 'install' | 'snapshot';
    readonly port: number;
  };
  readonly lifecycle: readonly ['open-resolved', 'run-created', 'preview-ready'];
  readonly terminalSnapshot: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  };
  readonly output: string;
  readonly preview: { readonly port: number; readonly url: string };
  readonly previewStatus: number;
  readonly previewBody: string;
  readonly viteVersion: string;
  readonly guestCapabilityProjection: {
    readonly present: boolean;
    readonly keys: readonly string[];
  };
  readonly closeExit: { readonly code: number | null; readonly signal: string | null };
}

function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function guestCapabilityProjection(
  output: string,
): ColdViteCompanionProof['guestCapabilityProjection'] {
  const start = output.indexOf(GUEST_CAPABILITY_PROJECTION_PREFIX);
  if (start < 0) throw new Error(`Vite guest capability projection is absent:\n${output}`);
  const jsonStart = start + GUEST_CAPABILITY_PROJECTION_PREFIX.length;
  const lineEnd = output.indexOf('\n', jsonStart);
  return JSON.parse(output.slice(jsonStart, lineEnd < 0 ? undefined : lineEnd).trim()) as {
    readonly present: boolean;
    readonly keys: readonly string[];
  };
}

/** Public-companion acceptance for the epic's deferred cold Vite journey. */
export async function runColdViteCompanion(): Promise<ColdViteCompanionProof> {
  const preset = PRESETS.find((candidate) => candidate.id === 'real-vite');
  if (preset === undefined || preset.setup !== 'from-scratch') {
    throw new Error('Real Vite from-scratch preset is missing');
  }
  const plan = toPlaygroundProjectPlan({
    projectId: 'scratch',
    starter: starterFromPreset(preset),
    setup: preset.setup,
  });
  if (plan.kind !== 'vite' || plan.firstMaterialization.kind !== 'install') {
    throw new Error('Real Vite preset did not map to deferred install materialization');
  }
  const probedPlan: PlaygroundProjectPlan = Object.freeze({
    ...plan,
    files: Object.freeze({ ...plan.files, '/vite.config.js': GUEST_CAPABILITY_PROBE_CONFIG }),
  });

  const ownerWorkerUrl = new URL(workbenchViteHostAssets.workers.owner, location.href);
  const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
  const baseElement = document.createElement('base');
  baseElement.dataset.coldViteCompanion = 'true';
  baseElement.href = ownerWorkerBaseUrl.href;
  document.head.prepend(baseElement);

  const workbench = await withTimeout(
    openPlaygroundWorkbench({
      deployment: {
        workers: {
          ...workbenchViteHostAssets.workers,
          owner: ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length),
        },
        serviceWorker: { url: '/sw.js', scope: '/' },
        wasm: workbenchViteHostAssets.wasm,
        previewProbeTimeoutMs: 30_000,
      },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: { persistence: 'ephemeral' },
    }),
    'Playground Workbench open',
    120_000,
  );

  try {
    const definition = workbench.playground.define(probedPlan);
    await withTimeout(
      workbench.playground.catalog.createScratch({ definition }),
      'Vite Scratch creation',
      30_000,
    );
    const session = await withTimeout(
      workbench.openProject(definition),
      'cold Vite Scratch open',
      120_000,
    );
    const lifecycle: ('open-resolved' | 'run-created' | 'preview-ready')[] = ['open-resolved'];

    try {
      const run = session.run();
      lifecycle.push('run-created');
      const terminalSnapshot = run.terminal.snapshot();
      let output = '';
      const detach = run.terminal.attach((chunk) => {
        output += chunk;
      });

      try {
        const preview = await withTimeout(run.ready, 'cold Vite preview ready', 300_000);
        lifecycle.push('preview-ready');
        const response = await withTimeout(
          fetch(new URL(preview.url, location.href), { cache: 'no-store' }),
          'cold Vite preview response',
          30_000,
        );
        const previewBody = await withTimeout(response.text(), 'cold Vite preview body', 30_000);
        const viteManifest = await withTimeout(
          session.files.readFile('/node_modules/vite/package.json'),
          'cold-installed Vite manifest read',
          30_000,
        );
        const viteVersion = (
          JSON.parse(new TextDecoder().decode(viteManifest.bytes)) as { readonly version: string }
        ).version;
        const closeExit = await withTimeout(run.close(), 'cold Vite run close', 60_000);

        return {
          plan: {
            kind: plan.kind,
            materializationKind: plan.firstMaterialization.kind,
            port: plan.port,
          },
          lifecycle: lifecycle as ['open-resolved', 'run-created', 'preview-ready'],
          terminalSnapshot,
          output,
          preview,
          previewStatus: response.status,
          previewBody,
          viteVersion,
          guestCapabilityProjection: guestCapabilityProjection(output),
          closeExit,
        };
      } finally {
        detach();
        await run.close().catch(() => {});
      }
    } finally {
      await session.close().catch(() => {});
    }
  } finally {
    await workbench.close().catch(() => {});
    baseElement.remove();
  }
}
