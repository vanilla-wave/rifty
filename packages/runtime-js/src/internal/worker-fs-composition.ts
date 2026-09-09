/** Internal Worker composition before the runtime captures its authoritative FS. */
let compose: (() => void) | undefined;

export function setRuntimeWorkerFsComposition(callback: () => void): void {
  if (compose !== undefined) throw new Error('runtime Worker filesystem composition already set');
  compose = callback;
}

export function composeRuntimeWorkerFs(): void {
  compose?.();
}
