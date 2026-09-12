/**
 * `vm` engine selector. Precedence: explicit override > `__RIFTY_VM_ENGINE`
 * (process.env then globalThis) > default. Default is `quickjs` (the real-realm
 * engine) since ADR-0142; ADR-0383 selects rewrite for the no-COI toolchain realm.
 *
 * PROCESS-GLOBAL by design (ADR-0142 §1): the engine is re-resolved per op from this
 * process-level state (set once at boot via the `vmEngine` host option / env), NOT
 * bound per-context — a ContextObject carries no engine identity. Flipping the
 * selection mid-process between a context's createContext and its runs is therefore
 * unsupported (the run would silently re-contextify under the other engine).
 */

import { isSandboxToolchainRealm } from '../../internal/sandbox-toolchain-realm.ts';
import { quickjsEngine } from './quickjs-engine.ts';
import { rewriteEngine } from './rewrite-engine.ts';
import type { VmEngine } from './types.ts';

let override: 'quickjs' | 'rewrite' | undefined;

export function setVmEngineOverride(name: 'quickjs' | 'rewrite' | undefined): void {
  override = name;
}

export function resolveVmEngineName(): 'quickjs' | 'rewrite' {
  if (override) return override;
  if (typeof process !== 'undefined' && process.env?.__RIFTY_VM_ENGINE) {
    const e = process.env.__RIFTY_VM_ENGINE;
    if (e === 'quickjs' || e === 'rewrite') return e;
  }
  const g = (globalThis as Record<string, unknown>).__RIFTY_VM_ENGINE;
  if (g === 'quickjs' || g === 'rewrite') return g;
  return isSandboxToolchainRealm() ? 'rewrite' : 'quickjs'; // ADR-0383 tier exception.
}

export function selectEngine(): VmEngine {
  return resolveVmEngineName() === 'quickjs' ? quickjsEngine : rewriteEngine;
}
