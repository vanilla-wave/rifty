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

interface PreparedShadowAssetCold {
  readonly preInspection: RuntimeAssetCacheInspection;
  readonly workbench: Workbench;
}

let activePhase: 'closing' | 'idle' | 'measuring' | 'preparing' = 'idle';
let prepared: PreparedShadowAssetCold | null = null;

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

function appendFailure(current: Error | null, next: unknown, message: string): Error {
  return new AggregateError(current === null ? [failure(next)] : [current, failure(next)], message);
}

async function closeWorkbenchBoundary(
  workbench: Workbench,
  initialFailure: Error | null,
  label: string,
): Promise<{
  readonly failure: Error | null;
  readonly lockReacquired: boolean;
  readonly workbenchClosed: boolean;
}> {
  let operationFailure = initialFailure;
  let workbenchClosed = false;
  let lockReacquired = false;
  try {
    await workbench.close();
    workbenchClosed = true;
  } catch (error) {
    operationFailure = appendFailure(operationFailure, error, `${label} Workbench cleanup failed`);
  }
  try {
    lockReacquired = await reacquireWorkbenchLock();
    if (!lockReacquired) {
      operationFailure = appendFailure(
        operationFailure,
        new Error('origin Web Lock remained held'),
        `${label} Web Lock proof failed`,
      );
    }
  } catch (error) {
    operationFailure = appendFailure(operationFailure, error, `${label} Web Lock proof failed`);
  }
  return { failure: operationFailure, lockReacquired, workbenchClosed };
}

/** Start the public Workbench owner and prove its asset store before CDP attaches. */
export async function prepareShadowAssetCold(
  options: ShadowAssetColdMeasurementOptions,
): Promise<void> {
  if (activePhase !== 'idle' || prepared !== null) {
    throw new Error('shadow-asset cold page is already prepared or active');
  }
  const packageAcquisition = shadowAssetColdPackageAcquisition(options);
  activePhase = 'preparing';
  let workbench: Workbench | null = null;
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
    const preInspection = await workbench.runtimeAssets.inspect();
    prepared = Object.freeze({ preInspection, workbench });
  } catch (error) {
    const operationFailure = failure(error);
    if (workbench === null) throw operationFailure;
    const cleanup = await closeWorkbenchBoundary(
      workbench,
      operationFailure,
      'shadow-asset cold preparation',
    );
    throw cleanup.failure ?? operationFailure;
  } finally {
    activePhase = 'idle';
  }
}

/** Abort a prepared page after recorder/setup failure. Safe after measure cleanup. */
export async function closeShadowAssetCold(): Promise<void> {
  if (activePhase !== 'idle') {
    throw new Error(`shadow-asset cold page cannot close while ${activePhase}`);
  }
  if (prepared === null) return;
  const workbench = prepared.workbench;
  prepared = null;
  activePhase = 'closing';
  let operationFailure: Error | null = null;
  try {
    try {
      await workbench.close();
    } catch (error) {
      operationFailure = appendFailure(
        operationFailure,
        error,
        'shadow-asset cold abort Workbench cleanup failed',
      );
    }
    try {
      const lockReacquired = await reacquireWorkbenchLock();
      if (!lockReacquired) {
        operationFailure = appendFailure(
          operationFailure,
          new Error('origin Web Lock remained held'),
          'shadow-asset cold abort Web Lock proof failed',
        );
      }
    } catch (error) {
      operationFailure = appendFailure(
        operationFailure,
        error,
        'shadow-asset cold abort Web Lock proof failed',
      );
    }
  } finally {
    activePhase = 'idle';
  }
  if (operationFailure !== null) throw operationFailure;
}

/** Consume one prepared public Workbench; always release project, owner, and lock. */
export async function measureShadowAssetCold(): Promise<ShadowAssetColdPageEvidence> {
  if (activePhase !== 'idle' || prepared === null) {
    throw new Error('shadow-asset cold page must be prepared before measurement');
  }
  const state = prepared;
  prepared = null;
  activePhase = 'measuring';
  const progress: Array<{ readonly atMs: number; readonly progress: RuntimeAssetProgress }> = [];
  let project: ProjectSession<unknown> | null = null;
  let postInspection: RuntimeAssetCacheInspection | null = null;
  let lockfileText: string | null = null;
  let openResolvedAtMs: number | null = null;
  let operationFailure: Error | null = null;
  let projectClosed = false;
  let cleanup = { workbenchClosed: false, lockReacquired: false };

  try {
    project = await state.workbench.openProject(
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
    postInspection = await state.workbench.runtimeAssets.inspect();
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
      operationFailure = appendFailure(
        operationFailure,
        error,
        'shadow-asset cold project cleanup failed',
      );
    }
  }
  try {
    const released = await closeWorkbenchBoundary(
      state.workbench,
      operationFailure,
      'shadow-asset cold measurement',
    );
    operationFailure = released.failure;
    cleanup = {
      workbenchClosed: released.workbenchClosed,
      lockReacquired: released.lockReacquired,
    };
  } finally {
    activePhase = 'idle';
  }
  if (operationFailure !== null) throw operationFailure;
  if (postInspection === null || lockfileText === null || openResolvedAtMs === null) {
    throw new Error('shadow-asset cold operation settled without complete page evidence');
  }
  return Object.freeze({
    preInspection: state.preInspection,
    progress: Object.freeze([...progress]),
    openResolvedAtMs,
    postInspection,
    lockfileText,
    cleanup: Object.freeze({ projectClosed, ...cleanup }),
  });
}
