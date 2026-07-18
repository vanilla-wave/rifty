import fixtureWorkerUrl from './workbench-runtime-asset-storage-fixture-worker.ts?worker&url';

export interface RuntimeAssetSeedResult {
  readonly assetMarker: string;
  readonly memberSha256: string;
  readonly requiredSetDigest: string;
  readonly tarballMarker: string;
  readonly usage: Readonly<{
    storageClass: 'opfs-persisted' | 'opfs-best-effort';
    entryCount: number;
    storedBytes: number;
    verifiedObjectCount: number;
    verifiedObjectBytes: number;
    readySetCount: number;
  }>;
}

export interface RuntimeAssetPhysicalInspection {
  readonly runtimeAssets: Readonly<{
    entryCount: number;
    storedBytes: number;
    entries: readonly unknown[];
  }>;
  readonly managerUsage: RuntimeAssetSeedResult['usage'];
  readonly lookup: Readonly<{
    name: string;
    phase: unknown;
    recovery: unknown;
  }>;
  readonly tarball: string | null;
  readonly retainedProject: boolean;
}

interface FixtureReply<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: Readonly<{ name: string; message: string }>;
}

function command<T>(type: 'seed' | 'inspect-after-clear'): Promise<T> {
  const worker = new Worker(fixtureWorkerUrl, { type: 'module' });
  return new Promise<T>((resolve, reject) => {
    const settle = (operation: () => void): void => {
      worker.terminate();
      operation();
    };
    worker.onmessage = (event: MessageEvent<FixtureReply<T>>) => {
      const reply = event.data;
      if (reply.ok && reply.result !== undefined) {
        settle(() => resolve(reply.result as T));
        return;
      }
      settle(() =>
        reject(
          new Error(
            `${reply.error?.name ?? 'Error'}: ${reply.error?.message ?? 'fixture worker failed'}`,
          ),
        ),
      );
    };
    worker.onerror = (event) => settle(() => reject(new Error(event.message)));
    worker.postMessage({ type });
  });
}

export function seedRuntimeAssetStorage(): Promise<RuntimeAssetSeedResult> {
  return command('seed');
}

export function inspectRuntimeAssetPhysicalStorage(): Promise<RuntimeAssetPhysicalInspection> {
  return command('inspect-after-clear');
}
