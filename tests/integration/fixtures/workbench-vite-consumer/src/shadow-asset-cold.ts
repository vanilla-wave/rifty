import serviceWorkerUrl from '@riftydev/service-worker/sw?worker&url';
import {
  type ProjectSession,
  type RuntimeAssetCacheInspection,
  type RuntimeAssetProgress,
  type Workbench,
  openWorkbench,
  projects,
} from '@riftydev/workbench';
import devServerWorkerUrl from '@riftydev/workbench/dev-server-worker?worker&url';
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url';
import nodeWorkerUrl from '@riftydev/workbench/node-worker?worker&url';
import ownerWorkerUrl from '@riftydev/workbench/owner-worker?worker&url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {
  type ShadowAssetColdMeasurementOptions,
  shadowAssetColdPackageAcquisition,
} from './shadow-asset-cold-options';

export type { ShadowAssetColdMeasurementOptions } from './shadow-asset-cold-options';

const WORKBENCH_LOCK = 'rifty:workbench:v1';

export interface ShadowAssetColdPageEvidence {
  readonly preInspection: RuntimeAssetCacheInspection;
  readonly progress: readonly Readonly<{
    readonly atMs: number;
    readonly progress: RuntimeAssetProgress;
  }>[];
  readonly openResolvedAtMs: number;
  readonly postInspection: RuntimeAssetCacheInspection;
  readonly lockfileText: string;
  readonly cleanup: Readonly<{
    readonly projectClosed: boolean;
    readonly workbenchClosed: boolean;
    readonly lockReacquired: boolean;
  }>;
}

function viteFiles(): Readonly<Record<string, string>> {
  return {
    '/index.html': '<div id="app">cold asset boundary</div>',
  };
}

async function reacquireWorkbenchLock(): Promise<boolean> {
  let acquired = false;
  await navigator.locks.request(
    WORKBENCH_LOCK,
    { mode: 'exclusive', ifAvailable: true },
    (lock) => {
      acquired = lock !== null;
    },
  );
  return acquired;
}

function failure(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** One page-owned measured operation; Node owns context/CDP isolation. */
export async function measureShadowAssetCold(
  options: ShadowAssetColdMeasurementOptions,
): Promise<ShadowAssetColdPageEvidence> {
  const packageAcquisition = shadowAssetColdPackageAcquisition(options);
  const progress: Array<{ readonly atMs: number; readonly progress: RuntimeAssetProgress }> = [];
  let workbench: Workbench | null = null;
  let project: ProjectSession<unknown> | null = null;
  let preInspection: RuntimeAssetCacheInspection | null = null;
  let postInspection: RuntimeAssetCacheInspection | null = null;
  let lockfileText: string | null = null;
  let openResolvedAtMs: number | null = null;
  let operationFailure: Error | null = null;
  let projectClosed = false;
  let workbenchClosed = false;
  let lockReacquired = false;

  try {
    workbench = await openWorkbench({
      deployment: {
        workers: {
          owner: ownerWorkerUrl,
          kernel: kernelWorkerUrl,
          node: nodeWorkerUrl,
          devServer: devServerWorkerUrl,
        },
        serviceWorker: { url: serviceWorkerUrl, scope: '/' },
        wasm: { sqlite: sqlWasmUrl },
        previewProbeTimeoutMs: 30_000,
      },
      packageAcquisition,
      storage: { persistence: 'preferred' },
    });
    preInspection = await workbench.runtimeAssets.inspect();
    project = await workbench.openProject(
      projects.vite({
        id: 'shadow-asset-cold',
        viteVersion: '7.3.6',
        files: viteFiles(),
      }),
      {
        onRuntimeAssetProgress: (entry) => {
          progress.push(Object.freeze({ atMs: performance.now(), progress: entry }));
        },
      },
    );
    openResolvedAtMs = performance.now();
    postInspection = await workbench.runtimeAssets.inspect();
    const lockfile = await project.files.readFile('/package-lock.json');
    lockfileText = new TextDecoder('utf-8', { fatal: true }).decode(lockfile.bytes);
  } catch (error) {
    operationFailure = failure(error);
  }

  if (project !== null) {
    try {
      await project.close();
      projectClosed = true;
    } catch (error) {
      operationFailure = new AggregateError(
        operationFailure === null ? [failure(error)] : [operationFailure, failure(error)],
        'shadow-asset cold project cleanup failed',
      );
    }
  }
  if (workbench !== null) {
    try {
      await workbench.close();
      workbenchClosed = true;
    } catch (error) {
      operationFailure = new AggregateError(
        operationFailure === null ? [failure(error)] : [operationFailure, failure(error)],
        'shadow-asset cold Workbench cleanup failed',
      );
    }
  }
  try {
    lockReacquired = await reacquireWorkbenchLock();
  } catch (error) {
    operationFailure = new AggregateError(
      operationFailure === null ? [failure(error)] : [operationFailure, failure(error)],
      'shadow-asset cold Web Lock proof failed',
    );
  }
  if (operationFailure !== null) throw operationFailure;
  if (
    preInspection === null ||
    postInspection === null ||
    lockfileText === null ||
    openResolvedAtMs === null
  ) {
    throw new Error('shadow-asset cold operation settled without complete page evidence');
  }
  return Object.freeze({
    preInspection,
    progress: Object.freeze([...progress]),
    openResolvedAtMs,
    postInspection,
    lockfileText,
    cleanup: Object.freeze({ projectClosed, workbenchClosed, lockReacquired }),
  });
}
