/**
 * `vm` engine selector. Precedence: explicit override > `__RIFTY_VM_ENGINE`
 * (process.env then globalThis) > default. Default stays `rewrite` until the
 * cutover (T17, ADR-0138) flips it to `quickjs`.
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
  return 'rewrite'; // NOTE: default FLIPS to 'quickjs' in a later task (T17); leave 'rewrite' now.
}

export function selectEngine(): VmEngine {
  return resolveVmEngineName() === 'quickjs' ? quickjsEngine : rewriteEngine;
}
