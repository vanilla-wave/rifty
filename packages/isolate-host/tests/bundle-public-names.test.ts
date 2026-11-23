/**
 * A bundler renames a function or class whose name shadows another binding
 * (`EventEmitter2`, `Stream2`), and V8 prints that name in frames the guest
 * sees. A `function`/`class` declaration in the isolate guest bundle named
 * after a Node builtin export plus a numeric suffix fails here. Not checked
 * yet: bound class expressions (`TextEncoder2 = class`), lowercase names and
 * the Workbench's browser bundles (`backlog/runtime-js/guest-builtin-names`).
 * Fix: name the function by a property key (ADR-0571).
 */
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const publicNames = new Set<string>();
for (const id of builtinModules) {
  let mod: Record<string, unknown>;
  try {
    mod = require(id) as Record<string, unknown>;
  } catch {
    continue;
  }
  for (const value of Object.values(mod ?? {}))
    if (typeof value === 'function' && /^[A-Z]/u.test(value.name)) publicNames.add(value.name);
}

function renamed(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:function|class)\s+([A-Z][A-Za-z]*?)(\d+)\b/gu)) {
    if (!publicNames.has(m[1] as string)) continue;
    out.push(`${file.split('/').slice(-3).join('/')}: ${m[0]}`);
  }
  return out;
}

it('no Node builtin name is renamed by the bundler in the isolate guest bundle', () => {
  const guest = new URL('../../isolate-guest/dist/guest.js', import.meta.url).pathname;
  expect(existsSync(guest), 'build the isolate guest first').toBe(true);
  expect(publicNames.has('EventEmitter')).toBe(true);
  expect(renamed(guest)).toEqual([]);
});
