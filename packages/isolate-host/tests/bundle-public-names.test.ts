/**
 * A bundler renames a function or class whose name shadows another binding
 * (`EventEmitter2`, `Stream2`, `Server2`), and V8 prints that name in frames
 * and `constructor` lookups the guest sees. Any declaration in the guest
 * bundle (and the Workbench's browser bundles, when built) named after a Node
 * builtin export plus a numeric suffix fails here — by construction, not by a
 * list of found cases. Fix: name the function by a property key (ADR-0571).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

// The npm `buffer` polyfill inside a Workbench dependency, not the guest's `buffer`.
const VENDOR = /required by `buffer` v5\.x/u;

function renamed(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:function|class)\s+([A-Z][A-Za-z]*?)(\d+)\b/gu)) {
    if (!publicNames.has(m[1] as string)) continue;
    if (VENDOR.test(text.slice(Math.max(0, m.index - 3000), m.index + 3000))) continue;
    out.push(`${file.split('/').slice(-3).join('/')}: ${m[0]}`);
  }
  return out;
}

it('no Node builtin name is renamed by the bundler in guest-reachable bundles', () => {
  const guest = new URL('../../isolate-guest/dist/guest.js', import.meta.url).pathname;
  expect(existsSync(guest), 'build the isolate guest first').toBe(true);
  const files = [guest];
  const assets = new URL('../../workbench/dist/assets/', import.meta.url).pathname;
  if (existsSync(assets))
    for (const name of readdirSync(assets))
      if (name.endsWith('.js')) files.push(`${assets}${name}`);
  expect(publicNames.has('EventEmitter')).toBe(true);
  expect(files.flatMap(renamed)).toEqual([]);
});
