import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it.each(['/x/v', 'using resource = acquire();', 'import x from "x" with { type: "json" };'])(
    'rejects post-ES2022 syntax: %s',
    (source) => {
      expect(violations(source).join('\n')).toContain('ES2022 syntax');
    },
  );

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
      const copy = [...items].sort(compare); copy.at(-1);
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

  it('allows only the named guarded Atomics.waitAsync exception', () => {
    expect(
      violations('if (typeof Atomics.waitAsync === "function") Atomics.waitAsync(a, 0, 0);'),
    ).toEqual([]);
    expect(
      violations('if (typeof Object.groupBy === "function") Object.groupBy(a, f);').join('\n'),
    ).toContain('Object.groupBy');
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
