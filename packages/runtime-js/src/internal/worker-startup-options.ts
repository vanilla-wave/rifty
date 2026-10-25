import { type VfsStorageOptions, captureVfsStorageOptions } from '@riftydev/vfs';
import type { VmEngineName } from '../protocol.ts';
import { vmEngineFromWorkerName, vmEngineWorkerName } from './worker-vm-engine.ts';

const CONFIG_PREFIX = 'rifty-worker-config=';
export const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

export interface RuntimeStartupOptions {
  readonly vmEngine?: VmEngineName;
  readonly storage?: VfsStorageOptions;
  readonly startupTimeoutMs?: number;
}

/** Capture once before effects; restart uses this same configuration. */
export function captureRuntimeStartupOptions(
  options: RuntimeStartupOptions,
): RuntimeStartupOptions {
  const vmEngine = options.vmEngine;
  vmEngineWorkerName(vmEngine);
  const storage = captureVfsStorageOptions(options.storage);
  const startupTimeoutMs =
    options.startupTimeoutMs === undefined ? DEFAULT_STARTUP_TIMEOUT_MS : options.startupTimeoutMs;
  if (
    typeof startupTimeoutMs !== 'number' ||
    !Number.isInteger(startupTimeoutMs) ||
    startupTimeoutMs < 1 ||
    startupTimeoutMs > 2_147_483_647
  )
    throw new RangeError('startupTimeoutMs must be an integer from 1 through 2147483647');
  return Object.freeze({
    ...(vmEngine === undefined ? {} : { vmEngine }),
    ...(storage === undefined ? {} : { storage }),
    startupTimeoutMs,
  });
}

export function runtimeWorkerName(options: RuntimeStartupOptions): string | undefined {
  if (options.storage === undefined) return vmEngineWorkerName(options.vmEngine);
  return CONFIG_PREFIX + JSON.stringify({ vmEngine: options.vmEngine, storage: options.storage });
}

export function runtimeWorkerOptionsFromName(name: string): RuntimeStartupOptions {
  if (!name.startsWith(CONFIG_PREFIX)) return { vmEngine: vmEngineFromWorkerName(name) };
  return captureRuntimeStartupOptions(JSON.parse(name.slice(CONFIG_PREFIX.length)));
}
