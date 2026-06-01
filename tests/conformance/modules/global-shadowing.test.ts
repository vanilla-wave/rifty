import { createModuleLoader } from '@rifty/runtime-js/loader';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

// The ESM transformer emits its export/re-export machinery as inline
// `Object.defineProperty(...)` / `Object.keys(...)` calls in the module body. A
// module may legally declare a module-scoped binding named `Object` (opencode's
// `config/permission.ts` does: `export const Object = Schema.Record(...)`), which
// would shadow the global and make bare `Object.*` in the generated code resolve
// to the user's value. The executor binds the REAL global to a mangled name
// (esm-ast.ts RUNTIME_OBJECT_BINDING) at function scope so the codegen survives.
// These cases exercise every codegen site (decl export, `export { x as y }`,
// `export { x } from`, `export * as ns from`, `export *`) under a shadowed Object.
describe('ESM modules that shadow the global Object', () => {
  it('`export const Object` + decl/specifier exports all resolve', async () => {
    const loader = setup({
      '/m.mjs':
        'export const Object = 42;\n' +
        'export const foo = "bar";\n' +
        'export function fn() { return 7; }\n' +
        'const baz = 8;\n' +
        'export { baz as qux };',
      '/main.mjs':
        'import { Object as Obj, foo, fn, qux } from "./m.mjs"; export const out = [Obj, foo, fn(), qux];',
    });
    const ns = await loader.import('/main.mjs', '/entry.mjs');
    expect(ns.out).toEqual([42, 'bar', 7, 8]);
  });

  it('`export *` from a module that shadows Object still merges names', async () => {
    const loader = setup({
      '/re.mjs': 'export const a = 1; export const b = 2;',
      '/m.mjs': 'export const Object = 99;\nexport * from "./re.mjs";',
      '/main.mjs': 'import { a, b, Object as Obj } from "./m.mjs"; export const out = [a, b, Obj];',
    });
    const ns = await loader.import('/main.mjs', '/entry.mjs');
    expect(ns.out).toEqual([1, 2, 99]);
  });

  it('named re-export and `export * as ns` work alongside a shadowed Object', async () => {
    const loader = setup({
      '/re.mjs': 'export const y = 5;',
      '/m.mjs':
        'export const Object = 1;\nexport { y } from "./re.mjs";\nexport * as NS from "./re.mjs";',
      '/main.mjs':
        'import { y, NS, Object as Obj } from "./m.mjs"; export const out = [y, NS.y, Obj];',
    });
    const ns = await loader.import('/main.mjs', '/entry.mjs');
    expect(ns.out).toEqual([5, 5, 1]);
  });
});
