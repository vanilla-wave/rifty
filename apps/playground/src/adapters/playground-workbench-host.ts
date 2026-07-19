import { WorkbenchOriginOccupiedError } from '@riftydev/workbench';
import devServerWorkerUrl from '@riftydev/workbench/dev-server-worker?worker&url';
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url';
import nodeWorkerUrl from '@riftydev/workbench/node-worker?worker&url';
import ownerWorkerUrl from '@riftydev/workbench/owner-worker?worker&url';
import type {
  OpenPlaygroundWorkbench,
  PlaygroundWorkbench,
  PlaygroundWorkbenchOptions,
} from '@riftydev/workbench/playground';
import { openPlaygroundWorkbench } from '@riftydev/workbench/playground';
import typescriptWorkerUrl from '@riftydev/workbench/typescript-worker?worker&url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { getRegistryProxyPrefix } from '../glue/registry-config.ts';
import { getEddyBundleBaseUrl, getResolverUrl } from '../glue/resolver-config.ts';

function presetPins(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new TypeError('VITE_RIFTY_EDDY_PINS must be JSON text');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `VITE_RIFTY_EDDY_PINS is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('VITE_RIFTY_EDDY_PINS must be a JSON object');
  }
  const result: Record<string, string> = {};
  for (const [templateId, hash] of Object.entries(parsed)) {
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new TypeError(`VITE_RIFTY_EDDY_PINS.${templateId} must be a non-empty string`);
    }
    result[templateId] = hash;
  }
  return Object.freeze(result);
}

/** Vite/bundler deployment boundary; semantic App code receives no worker URLs. */
export function playgroundWorkbenchOptions(): PlaygroundWorkbenchOptions {
  const resolverUrl = getResolverUrl();
  const bundleBaseUrl = getEddyBundleBaseUrl();
  const pins = presetPins(import.meta.env.VITE_RIFTY_EDDY_PINS);
  return Object.freeze({
    deployment: Object.freeze({
      workers: Object.freeze({
        owner: ownerWorkerUrl,
        kernel: kernelWorkerUrl,
        node: nodeWorkerUrl,
        devServer: devServerWorkerUrl,
        typescript: typescriptWorkerUrl,
      }),
      serviceWorker: Object.freeze({ url: '/sw.js', scope: '/' }),
      wasm: Object.freeze({ sqlite: sqlWasmUrl }),
      previewProbeTimeoutMs: 30_000,
    }),
    packageAcquisition: Object.freeze({
      registryUrl: getRegistryProxyPrefix(),
      ...(resolverUrl === undefined
        ? {}
        : {
            eddy: Object.freeze({
              resolverUrl,
              ...(bundleBaseUrl === undefined ? {} : { bundleBaseUrl }),
              ...(pins === undefined ? {} : { presetPins: pins }),
            }),
          }),
    }),
    storage: Object.freeze({ persistence: 'preferred' as const }),
  });
}

export interface OpenedPlaygroundAppWorkbench {
  readonly status: 'opened';
  readonly workbench: PlaygroundWorkbench;
}

export interface OccupiedPlaygroundAppWorkbench {
  readonly status: 'occupied';
}

export type PlaygroundAppWorkbenchOpenOutcome =
  | OpenedPlaygroundAppWorkbench
  | OccupiedPlaygroundAppWorkbench;

export function createOpenPlaygroundAppWorkbench(
  open: OpenPlaygroundWorkbench,
): () => Promise<PlaygroundAppWorkbenchOpenOutcome> {
  return async () => {
    try {
      const workbench = await open(playgroundWorkbenchOptions());
      return Object.freeze({ status: 'opened' as const, workbench });
    } catch (error) {
      if (error instanceof WorkbenchOriginOccupiedError) {
        return Object.freeze({ status: 'occupied' as const });
      }
      throw error;
    }
  };
}

export const openPlaygroundAppWorkbench = createOpenPlaygroundAppWorkbench(openPlaygroundWorkbench);
