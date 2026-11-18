/**
 * Loud gaps for the shim without importing `@riftydev/io` at shim load (the
 * shim must evaluate before any runtime module). The entry binds io's
 * `NotImplementedError` right after the runtime loads; every throw happens
 * at call time, after that.
 */
type NotImplementedCtor = new (feature: string, hint?: string) => Error;
let NotImplemented: NotImplementedCtor | null = null;

export function bindNotImplemented(ctor: NotImplementedCtor): void {
  NotImplemented = ctor;
}

export function notImplemented(feature: string, hint?: string): Error {
  if (NotImplemented === null)
    throw new Error(`isolate-host guest: ${feature} before runtime load`);
  return new NotImplemented(feature, hint);
}
