// THROWAWAY: experimental Worker; never a published entry.
if (new URL(import.meta.url).searchParams.get('prototype') === '1') {
  Reflect.set(globalThis, Symbol.for('rifty.prototype.no-coi-resources.v1'), true);
}
await import('./no-coi-toolchain-worker.ts');
