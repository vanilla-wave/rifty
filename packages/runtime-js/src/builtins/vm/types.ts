/**
 * Shared `vm` types + the {@link VmEngine} interface the dispatcher
 * (`vm/index.ts`) selects between (quickjs default, rewrite opt-in — ADR-0142 /
 * T17). `runInThisContext` is deliberately NOT on the engine: it always runs in
 * the host realm via `(0,eval)` and never goes through a sandbox engine.
 */

/**
 * Marks a contextified object. `Symbol.for` (cross-realm registry) keeps the key
 * stable across module instances so an object contextified by one path is still
 * recognised by another.
 */
export const VM_CONTEXT = Symbol.for('rifty.vm.context');

export interface ContextCodeGeneration {
  readonly strings: boolean;
  readonly wasm: boolean;
}

export type ContextObject = Record<string, unknown> & { [VM_CONTEXT]?: true };

const contextCodeGeneration = new WeakMap<ContextObject, ContextCodeGeneration>();

export function setContextCodeGeneration(
  context: ContextObject,
  policy: ContextCodeGeneration,
): void {
  contextCodeGeneration.set(context, policy);
}

export function getContextCodeGeneration(
  context: ContextObject,
): ContextCodeGeneration | undefined {
  return contextCodeGeneration.get(context);
}

/** Shared `vm.isContext` predicate (used by the public surface and the engines). */
export function isVmContext(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    (value as ContextObject)[VM_CONTEXT] === true
  );
}

/** A precompiled `vm.Script` payload. Engines memoise their own state by identity. */
export interface CompiledScript {
  readonly code: string;
  readonly filename?: string;
}

/** Sandbox-API engine. runInThisContext is NOT here — it stays host-realm in index.ts. */
export interface VmEngine {
  readonly name: 'quickjs' | 'rewrite';
  /** Called when a fresh object is contextified (createContext). */
  initContext(context: ContextObject): void;
  /** Run source against a contextified object; return the completion value. */
  runInContext(code: string, context: ContextObject, filename?: string): unknown;
  /** vm.Script support: precompile + run. */
  compile(code: string, filename?: string): CompiledScript;
  runCompiled(script: CompiledScript, context: ContextObject): unknown;
  /**
   * Release engine state when the context is torn down. Reserved seam: no
   * dispatcher/public caller today — production teardown is GC-only (the
   * ContextObject finalizer marks the lifetime controller pending, mirroring Node's
   * lack of vm-context teardown). Kept for the M11 embeddable sandbox teardown
   * contract. TODO(backlog: runtime-js/vm-unwired-seams)
   */
  disposeContext(context: ContextObject): void;
}
