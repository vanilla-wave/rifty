/** Internal Worker composition before the runtime captures its authoritative FS. */
let compose: (() => void) | undefined;

export function setRuntimeWorkerFsComposition(callback: () => void): void {
  if (compose !== undefined) throw new Error('runtime Worker filesystem composition already set');
  compose = callback;
}

export function composeRuntimeWorkerFs(): void {
  compose?.();
}

let invalidateModules: (() => void) | undefined;

export function setRuntimeWorkerModuleInvalidation(callback: () => void): void {
  invalidateModules = callback;
}

export function invalidateRuntimeWorkerModules(): void {
  if (invalidateModules === undefined) throw new Error('runtime Worker module loader is not ready');
  invalidateModules();
}
