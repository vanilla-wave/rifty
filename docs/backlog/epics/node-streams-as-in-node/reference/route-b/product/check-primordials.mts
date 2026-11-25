// bindings.ts `primordials` vs this Node's own (node --expose-internals --import tsx check-primordials.mts GEN):
// every name the generated modules read exists; values equal Node's, or (uncurried/bound/Safe*) the same kind.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makePrimordials } from './bindings.ts';

const primordials = makePrimordials();

const node = createRequire(import.meta.url)('internal/test/binding').primordials;
const { PRIMORDIALS } = await import(pathToFileURL(process.argv[2] ?? '').href);
const rows: string[] = [];
for (const n of PRIMORDIALS as string[]) {
  const a = primordials[n];
  const b = node[n];
  const kind =
    a === b
      ? 'identical'
      : typeof a === typeof b &&
          typeof a === 'function' &&
          a.name === b.name &&
          a.length === b.length
        ? `same kind (${a.name || 'anonymous'}/${a.length})`
        : typeof a === 'function' && typeof b === 'function' && a.length === b.length
          ? `same kind, name ${a.name} vs '${b.name}' (internal helper)`
          : `DIFF ${typeof a} ${String(a?.name)} vs ${typeof b} ${String(b?.name)}`;
  rows.push(`${n}: ${kind}`);
}
console.log(rows.join('\n'));
console.log(`${PRIMORDIALS.length} names; DIFF ${rows.filter((r) => r.includes('DIFF')).length}`);
