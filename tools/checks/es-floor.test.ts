import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync, transformSync } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleViolations, checkBundleRoots } from './es-floor.mjs';

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const violations = (source: string) => bundleViolations('worker.js', source);

describe('shipped ES2022 floor', () => {
  it.each([
    ['Object.groupBy(items, key)', 'Object.groupBy'],
    ['Object["groupBy"](items, key)', 'Object.groupBy'],
    ['const group = Object.groupBy; group(items, key)', 'Object.groupBy'],
    ['globalThis.Object.groupBy(items, key)', 'Object.groupBy'],
    ['const { groupBy: group } = Object; group(items, key)', 'Object.groupBy'],
    ['Promise.withResolvers()', 'Promise.withResolvers'],
    ['Array.fromAsync(source)', 'Array.fromAsync'],
    ['items.toSorted(compare)', 'toSorted'],
    ['items["toSorted"]()', 'toSorted'],
    ['items?.toReversed()', 'toReversed'],
    ['items.toSpliced(1, 2)', 'toSpliced'],
    ['items.findLast(predicate)', 'findLast'],
    ['items.findLastIndex(predicate)', 'findLastIndex'],
    ['[1, 2].with(0, 3)', 'with'],
    ['new Uint8Array(2).with(0, 3)', 'with'],
    ['const items = [1, 2]; items.with(0, 3)', 'with'],
    ['Array.from(source).with(0, 3)', 'with'],
    ['items.map(f).with(0, 3)', 'with'],
    ['unknown.with(0, 3)', 'with'],
    ['new RegExp("x", "v")', 'RegExp v'],
  ])('rejects %s with file and builtin', (source, builtin) => {
    expect(violations(source).join('\n')).toContain('worker.js:1:');
    expect(violations(source).join('\n')).toContain(builtin);
  });

  it.each([
    ['Array.prototype.toSorted.call(items, compare)', 'toSorted'],
    ['Array.prototype["toSorted"].apply(items, [compare])', 'toSorted'],
    ['const sort = Array.prototype.toSorted; sort.call(items)', 'toSorted'],
    ['const sort = items.toSorted; sort.call(items)', 'toSorted'],
    ['const { toSorted: sort } = Array.prototype; sort.call(items)', 'toSorted'],
    ['let sort; ({ toSorted: sort } = Array.prototype); sort.call(items)', 'toSorted'],
    ['const { prototype: { toSorted: sort } } = Array; sort.call(items)', 'toSorted'],
    ['Array.prototype.toReversed.call(items)', 'toReversed'],
    ['const reverse = items.toReversed.bind(items); reverse()', 'toReversed'],
    ['const { toSpliced } = items; toSpliced.call(items, 1)', 'toSpliced'],
    ['Array.prototype.findLast.call(items, predicate)', 'findLast'],
    ['const { findLastIndex: last } = items; last.call(items, predicate)', 'findLastIndex'],
    ['const replace = Uint8Array.prototype.with; replace.call(items, 0, 1)', 'with'],
    ['const { with: replace } = items; replace.call(items, 0, 1)', 'with'],
    ['const { withResolvers: make } = Promise; make()', 'Promise.withResolvers'],
    ['const { fromAsync: make } = Array; make(source)', 'Array.fromAsync'],
  ])('rejects indirect builtin access: %s', (source, builtin) => {
    expect(violations(source).join('\n')).toContain(builtin);
  });

  it.each([
    ['Iterator.from(items).toArray()', 'Iterator.from'],
    ['const from = Iterator.from; from(items)', 'Iterator.from'],
    ['const { from } = Iterator; from(items)', 'Iterator.from'],
    ['globalThis.Iterator.from(items)', 'Iterator.from'],
    ['Iterator.prototype.map.call(iterator, f)', 'Iterator.prototype.map'],
    ['new ArrayBuffer(8).transfer()', 'ArrayBuffer.prototype.transfer'],
    ['ArrayBuffer.prototype.transfer.call(buffer)', 'ArrayBuffer.prototype.transfer'],
    [
      'const transfer = ArrayBuffer.prototype.transfer; transfer.call(buffer)',
      'ArrayBuffer.prototype.transfer',
    ],
    [
      'const { transfer } = ArrayBuffer.prototype; transfer.call(buffer)',
      'ArrayBuffer.prototype.transfer',
    ],
    ['new ArrayBuffer(8, { maxByteLength: 16 }).resize(16)', 'ArrayBuffer.prototype.resize'],
    ['ArrayBuffer.prototype.resize.call(buffer, 16)', 'ArrayBuffer.prototype.resize'],
    [
      'new SharedArrayBuffer(8, { maxByteLength: 16 }).grow(16)',
      'SharedArrayBuffer.prototype.grow',
    ],
    ['SharedArrayBuffer.prototype.grow.call(buffer, 16)', 'SharedArrayBuffer.prototype.grow'],
    [
      'const { prototype: { transfer } } = ArrayBuffer; transfer.call(buffer)',
      'ArrayBuffer.prototype.transfer',
    ],
    [
      'const { prototype: { getFloat16 } } = DataView; getFloat16.call(view, 0)',
      'DataView.prototype.getFloat16',
    ],
    ['const { Object: { groupBy } } = globalThis; groupBy(items, key)', 'Object.groupBy'],
    ['new Float16Array(4)', 'Float16Array'],
    ['Float16Array.from(values)', 'Float16Array.from'],
    ['DataView.prototype.getFloat16.call(view, 0)', 'DataView.prototype.getFloat16'],
    [
      'const get = DataView.prototype.getFloat16; get.call(view, 0)',
      'DataView.prototype.getFloat16',
    ],
    [
      'const { setFloat16 } = DataView.prototype; setFloat16.call(view, 0, 1)',
      'DataView.prototype.setFloat16',
    ],
    ['new DataView(buffer).setFloat16(0, 1)', 'DataView.prototype.setFloat16'],
  ])('rejects post-floor intrinsic: %s', (source, builtin) => {
    expect(violations(source).join('\n')).toContain(builtin);
  });

  it('preserves pre-floor Array, WebAssembly memory and own iterator methods', () => {
    expect(
      violations(`
      Array.from(items).map(f);
      new Uint16Array(4).map(f);
      new WebAssembly.Memory({ initial: 1 }).grow(1);
      memory.grow(1); terminal.resize(80, 24); port.transfer(value);
      iterator.map(f); iterator.from(items);
    `),
    ).toEqual([]);
  });

  it('rejects the real emitted ES2022 prototype-call regression', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rifty-es-floor-'));
    scratch.push(directory);
    const emitted = transformSync(
      'const files=[{path:"/b"},{path:"/a"}]; globalThis.result=Array.prototype.toSorted.call(files, (a,b)=>a.path.localeCompare(b.path));',
      { target: 'es2022', minify: true },
    ).code;
    writeFileSync(join(directory, 'worker.js'), emitted);
    expect(checkBundleRoots([directory]).errors.join('\n')).toContain('toSorted');
  });

  it.each(['/x/v', 'using resource = acquire();', 'import x from "x" with { type: "json" };'])(
    'rejects post-ES2022 syntax: %s',
    (source) => {
      expect(violations(source).join('\n')).toContain('ES2022 syntax');
    },
  );

  it('still rejects Set union on a non-this receiver', () => {
    expect(violations('new Set([1]).union(other); left.union(right);').join('\n')).toContain(
      'union',
    );
    expect(
      violations('class Tags extends Set { merge(other) { return this.union(other); } }').join(
        '\n',
      ),
    ).toContain('union');
  });

  it('accepts ES2022 syntax, library name tables and own with methods', () => {
    expect(
      violations(`
      class X { #value = 1; static { this.version = 1; } }
      const names = { es2024: ['withResolvers', 'groupBy'] };
      const own = { with(value) { return value; } };
      own.with({ path: '/app' });
      semver.with({ prerelease: '0' });
      textChanges.ChangeTracker.with({ host, formatContext, preferences }, callback);
      
      this.getBracketPairsInRange(range).findLast(predicate);
      class Compiler { union(branches) { return branches; } emit(node) { return this.union(node.anyOf); } }
      const copy = [...items].sort(compare); copy.at(-1);
      request.with = importAttributes;
      typeof uri.with === 'function';
      callback({ path: request.path, namespace: request.namespace, pluginData, with: request.with });
    `),
    ).toEqual([]);
  });

  it('binds ambiguous Monaco own methods to the version and exact original expression', () => {
    const generated = 'p.with(void 0, column);';
    const original = 'position.with(undefined, idx + 1);';
    const map = (source: string, content = original) =>
      JSON.stringify({
        version: 3,
        sources: [source],
        sourcesContent: [content],
        names: [],
        mappings: 'AAAA',
      });
    const origin =
      'node_modules/monaco-editor@0.52.2/node_modules/monaco-editor/esm/vs/editor/common/cursor/cursorDeleteOperations.js';
    expect(bundleViolations('worker.js', generated, () => map(origin))).toEqual([]);
    expect(violations(generated).join('\n')).toContain('with');
    expect(bundleViolations('worker.js', generated, () => map('src/app.js')).join('\n')).toContain(
      'with',
    );
    expect(
      bundleViolations('worker.js', generated, () => map(origin, 'array.with(0, 1)')).join('\n'),
    ).toContain('with');
  });

  it.each([
    'Atomics.waitAsync(words, 0, 0)',
    'globalThis.Atomics.waitAsync(words, 0, 0)',
    'const native = Atomics; native.waitAsync(words, 0, 0)',
    'if (true) { var native = Atomics; } native.waitAsync(words, 0, 0)',
    'let native; native = Atomics; native.waitAsync(words, 0, 0)',
    'const { Atomics: native } = globalThis; native.waitAsync(words, 0, 0)',
    'const wait = Atomics.waitAsync; wait(words, 0, 0)',
    'const { waitAsync: wait } = Atomics; wait(words, 0, 0)',
    'Atomics.waitAsync.call(Atomics, words, 0, 0)',
    'if (typeof Atomics.waitAsync !== "function") Atomics.waitAsync(words, 0, 0)',
    'if (typeof unrelated === "function") Atomics.waitAsync(words, 0, 0)',
    'const wait = Atomics.waitAsync; try { throw unrelated; } catch (wait) { if (typeof wait === "function") Atomics.waitAsync(words, 0, 0); }',
  ])('rejects unguarded waitAsync: %s', (source) => {
    expect(violations(source).join('\n')).toContain('Atomics.waitAsync');
  });

  it.each([
    'typeof Atomics.waitAsync(words, 0, 0)',
    'typeof Atomics.waitAsync.call(Atomics, words, 0, 0)',
    'typeof Atomics.waitAsync.bind(Atomics)',
    'typeof Atomics.waitAsync.call',
    'typeof Atomics.waitAsync.name',
    'typeof (0, Atomics.waitAsync(words, 0, 0))',
    'const wait = Atomics.waitAsync; typeof wait(words, 0, 0)',
    'const native = Atomics; typeof native.waitAsync(words, 0, 0)',
  ])('does not mistake typeof an invocation for feature detection: %s', (source) => {
    expect(violations(source).join('\n')).toContain('Atomics.waitAsync');
  });

  it('binds a local waitAsync exception to its own positive feature check', () => {
    const source = 'if (typeof Atomics.waitAsync === "function") Atomics.waitAsync(words, 0, 0);';
    expect(violations(source)).toEqual([]);
    expect(
      violations(source.replace('typeof Atomics.waitAsync === "function"', 'true')).join('\n'),
    ).toContain('Atomics.waitAsync');
    expect(violations('typeof Atomics.waitAsync === "function"')).toEqual([]);
    expect(
      violations('typeof Atomics.waitAsync === "function" && Atomics.waitAsync(words, 0, 0)'),
    ).toEqual([]);
  });

  it('accepts captured stdio binding only while every use is feature-guarded', () => {
    const source = `const native = Atomics;
      const wait = native.waitAsync;
      const bound = typeof wait === 'function' ? wait.bind(native) : null;
      bound?.(words, 0, 0);`;
    expect(violations(source)).toEqual([]);
    expect(violations(source.replace("typeof wait === 'function'", 'true')).join('\n')).toContain(
      'Atomics.waitAsync',
    );
    expect(violations(`${source} wait(words, 0, 0);`).join('\n')).toContain('Atomics.waitAsync');
  });

  it('checks the real ring wrapper before and after removing its local guard', () => {
    const source = readFileSync('packages/kernel/src/ipc/sab-ring.ts', 'utf8');
    const emitted = transformSync(source, { loader: 'ts', target: 'es2022', minify: true }).code;
    expect(violations(emitted)).toEqual([]);
    const unguarded = emitted.replace(/if\(typeof [^;]+?throw new TypeError\([^;]+?;/, '');
    expect(unguarded).not.toBe(emitted);
    expect(violations(unguarded).join('\n')).toContain('Atomics.waitAsync');
  });

  it('requires a local capability check even inside a failure-reporting probe', () => {
    const source = `function probe(id, operation) {
      try { operation(); }
      catch (error) { globalThis.postMessage({ status: 'failed', error }); }
    }
    probe('shared-memory', () => Atomics.waitAsync(words, 0, 0));`;
    expect(violations(source).join('\n')).toContain('Atomics.waitAsync');
  });

  it('accepts a guarded callback without inferring anything about its runner', () => {
    const source = `run(() => {
      const native = Atomics;
      if (typeof native.waitAsync !== 'function') throw new TypeError('missing');
      return native.waitAsync(words, 0, 0);
    });`;
    expect(violations(source)).toEqual([]);
  });

  it.each([
    `let wait = () => ({ value: 'fallback' });
      if (typeof Atomics.waitAsync === 'function') wait = Atomics.waitAsync;
      if (typeof wait === 'function') Atomics.waitAsync(words, 0, 0);`,
    `const native = Atomics;
      try { throw { waitAsync: () => 1 }; }
      catch (native) { if (typeof native.waitAsync === 'function') Atomics.waitAsync(words, 0, 0); }`,
    `function run({ Atomics }) {
      if (typeof Atomics.waitAsync === 'function') globalThis.Atomics.waitAsync(words, 0, 0);
    } run({ Atomics: { waitAsync: () => 1 } });`,
  ])('does not grant native availability from an ambiguous or shadowed alias: %s', (source) => {
    expect(violations(source).join('\n')).toContain('Atomics.waitAsync');
  });

  it.each([
    `var native = Atomics;
      native.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0);
      var native = {};`,
    `const native = Atomics; {
      const { native = { waitAsync: () => 1 } } = {};
      if (typeof native.waitAsync === 'function') Atomics.waitAsync(words, 0, 0);
    }`,
    `const native = Atomics; {
      const [native] = [{ waitAsync: () => 1 }];
      if (typeof native.waitAsync === 'function') Atomics.waitAsync(words, 0, 0);
    }`,
  ])('retains possible native bindings without borrowing outer shadow guarantees: %s', (source) => {
    expect(violations(source).join('\n')).toContain('Atomics.waitAsync');
    for (const minify of [false, true]) {
      const emitted = transformSync(source, { target: 'es2022', minify }).code;
      expect(violations(emitted).join('\n')).toContain('Atomics.waitAsync');
    }
  });

  it.each(['support-worker.ts', 'check-sandbox-support.ts'])(
    'requires the local native guard in real emitted %s',
    (entry) => {
      const emitted = buildSync({
        entryPoints: [`packages/workbench/src/support/${entry}`],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
      }).outputFiles[0].text;
      expect(violations(emitted)).toEqual([]);
      const withoutLocalGuard = emitted.replace(
        /if \(typeof atomics\.waitAsync !== "function"\) \{\s*throw new TypeError\("Atomics\.waitAsync is not a function"\);\s*\}/,
        '',
      );
      expect(withoutLocalGuard).not.toBe(emitted);
      expect(violations(withoutLocalGuard).join('\n')).toContain('Atomics.waitAsync');
    },
  );

  it('allows only the named guarded Atomics.waitAsync exception', () => {
    expect(
      violations('if (typeof Atomics.waitAsync === "function") Atomics.waitAsync(a, 0, 0);'),
    ).toEqual([]);
    expect(
      violations('if (typeof Object.groupBy === "function") Object.groupBy(a, f);').join('\n'),
    ).toContain('Object.groupBy');
  });

  it.each([
    ['nativeGetter(ArrayBuffer.prototype, "detached")', 'ArrayBuffer.prototype.detached'],
    [
      'Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "detached").get.call(b)',
      'ArrayBuffer.prototype.detached',
    ],
    [
      'const P = ArrayBuffer.prototype; const k = "detached"; read(P, k)',
      'ArrayBuffer.prototype.detached',
    ],
    ['Reflect.get(Object, `groupBy`)(items, key)', 'Object.groupBy'],
    ['Reflect.get(Array.prototype, "toSorted").call(items)', 'Array.prototype.toSorted'],
    ['new (Reflect.get(globalThis, "Iterator"))()', 'Iterator'],
    ['Reflect.get(Atomics, "waitAsync")(words, 0, 0)', 'Atomics.waitAsync'],
    // A wrapper may throw on absence before any presence check runs.
    [
      'const d = nativeGetter(ArrayBuffer.prototype, "detached"); if (d !== void 0) d.call(b)',
      'ArrayBuffer.prototype.detached',
    ],
    [
      'const t = Reflect.get(ArrayBuffer.prototype, "transfer"); t.call(b)',
      'ArrayBuffer.prototype.transfer',
    ],
    [
      'var t = Reflect.get(ArrayBuffer.prototype, "transfer"); t = f; if (t !== void 0) t.call(b)',
      'ArrayBuffer.prototype.transfer',
    ],
    [
      'const t = Reflect.get(ArrayBuffer.prototype, "transfer"); if (t !== null) t.call(b)',
      'ArrayBuffer.prototype.transfer',
    ],
  ])('rejects a listed builtin reached by name: %s', (source, builtin) => {
    expect(violations(source).join('\n')).toContain(`${builtin} (by name)`);
  });

  it.each([
    'nativeGetter(ArrayBuffer.prototype, "byteLength")',
    'function read(target) { return Object.getOwnPropertyDescriptor(target, "detached"); }',
    'let k = "detached"; k = "byteLength"; read(ArrayBuffer.prototype, k)',
    'Reflect.get(Foo.prototype, "union")',
    'const t = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "transfer")?.value; if (t !== undefined) t.call(b)',
    'const t = Reflect.get(ArrayBuffer.prototype, "transfer"); function f(b) { if (t === void 0) return b; return t.call(b); }',
    'const g = Reflect.get(ArrayBuffer.prototype, "detached"); const f = (b) => typeof g === "function" ? g.call(b) : 0',
    'if (typeof Atomics.waitAsync === "function") Reflect.get(Atomics, "waitAsync")(words, 0, 0)',
  ])('accepts by-name reads that are pre-floor or presence-checked: %s', (source) => {
    expect(violations(source)).toEqual([]);
  });

  it('rejects the real port-ref install when it reads the Chrome 114 detached getter', () => {
    const bundle = (contents: string) =>
      buildSync({
        stdin: {
          contents,
          resolveDir: 'packages/runtime-js/src/internal',
          sourcefile: 'message-port-ref.ts',
          loader: 'ts',
        },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify: true,
      }).outputFiles[0].text;
    const source = readFileSync('packages/runtime-js/src/internal/message-port-ref.ts', 'utf8');
    expect(violations(bundle(source))).toEqual([]);
    const mutant = source.replace(
      "nativeGetter(ArrayBuffer.prototype, 'byteLength')",
      "nativeGetter(ArrayBuffer.prototype, 'detached')",
    );
    expect(mutant).not.toBe(source);
    expect(violations(bundle(mutant)).join('\n')).toContain(
      'ArrayBuffer.prototype.detached (by name)',
    );
  });

  it('admits the real blob store transfer probe only while every use checks presence', () => {
    const source = readFileSync('packages/isolate-guest/src/guest/node-blob/byte-store.ts', 'utf8');
    const emitted = transformSync(source, { loader: 'ts', target: 'es2022' }).code;
    expect(violations(emitted)).toEqual([]);
    const unchecked = emitted.replace('if (transferBuffer !== void 0) {', 'if (true) {');
    expect(unchecked).not.toBe(emitted);
    expect(violations(unchecked).join('\n')).toContain('ArrayBuffer.prototype.transfer (by name)');
  });

  it('checks nested package and playground assets, ignoring maps and declarations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rifty-es-floor-'));
    scratch.push(directory);
    const packageRoot = join(directory, 'package-dist');
    const appRoot = join(directory, 'playground-dist');
    mkdirSync(join(packageRoot, 'assets'), { recursive: true });
    mkdirSync(appRoot);
    writeFileSync(join(packageRoot, 'assets', 'worker.js'), 'Object.groupBy(items, key);');
    writeFileSync(join(appRoot, 'index.js'), 'items.toSorted();');
    writeFileSync(join(appRoot, 'index.js.map'), 'invalid JavaScript');
    writeFileSync(join(appRoot, 'index.d.ts'), 'declare const x: string;');
    const result = checkBundleRoots([packageRoot, appRoot]);
    expect(result.files).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join('\n')).toContain('assets/worker.js');
    expect(result.errors.join('\n')).toContain('playground-dist/index.js');
  });

  it('fails when a required build root is absent or contains no JavaScript', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rifty-es-floor-'));
    scratch.push(directory);
    expect(checkBundleRoots([join(directory, 'absent')]).errors.join('\n')).toContain(
      'Missing build',
    );
    expect(checkBundleRoots([directory]).errors.join('\n')).toContain('No JavaScript');
  });
});
