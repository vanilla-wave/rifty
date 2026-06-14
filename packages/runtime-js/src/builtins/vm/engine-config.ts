/**
 * `vm` engine selector. Precedence: explicit override > `__RIFTY_VM_ENGINE`
 * (process.env then globalThis) > default. Default is `quickjs` (the real-realm
 * engine) since the T17 cutover (ADR-0138); `rewrite` is the loud opt-in floor.
 */

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
  return 'quickjs'; // cutover default (T17, ADR-0138); rewrite is the loud opt-in.
}

export function selectEngine(): VmEngine {
  return resolveVmEngineName() === 'quickjs' ? quickjsEngine : rewriteEngine;
}
