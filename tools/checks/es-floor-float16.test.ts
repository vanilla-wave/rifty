import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { bundleViolations } from './es-floor.mjs';

const violations = (source: string) => bundleViolations('worker.js', source);

describe('feature-detected Float16Array at the ES2022 floor', () => {
  it.each([
    'typeof globalThis.Float16Array === "function"',
    'const table = { F16: typeof Float16Array === "undefined" ? undefined : Float16Array };',
    'const table = { F16: typeof Float16Array > "u" ? undefined : Float16Array };',
    'const C = typeof globalThis.Float16Array === "function" ? globalThis.Float16Array : undefined;',
    'const C = typeof Float16Array === "function" ? Float16Array : undefined;',
    'if (typeof Float16Array === "function") new Float16Array(2);',
    'if (typeof globalThis.Float16Array === "function") new globalThis.Float16Array(2);',
    'const C = globalThis.Float16Array; if (typeof C === "function") new C(2);',
  ])('accepts its own positive availability check: %s', (source) => {
    expect(violations(source)).toEqual([]);
    expect(violations(transformSync(source, { target: 'es2022', minify: true }).code)).toEqual([]);
  });

  it.each([
    'new Float16Array(2)',
    'const C = Float16Array; new C(2)',
    'const C = Float16Array; if (typeof C === "function") new C(2)',
    'const C = globalThis.Float16Array; new C(2)',
    'const C = true ? globalThis.Float16Array : undefined; new C(2)',
    'if (typeof Float16Array !== "function") new Float16Array(2)',
    'if (typeof Atomics.waitAsync === "function") new Float16Array(2)',
    'function f(Float16Array) { if (typeof Float16Array === "function") new globalThis.Float16Array(2); }',
    'let C = globalThis.Float16Array; if (typeof C === "function") { C = replacement; new C(2); }',
    'typeof new Float16Array(2)',
    'const table = { F16: typeof Float16Array > "z" ? undefined : Float16Array };',
    'if (typeof Float16Array !== "undefined") new (0, Float16Array)(2)',
    'const table = { F16: typeof Float16Array > "u" ? Float16Array : undefined };',
    'const table = { F16: typeof Float16Array < "u" ? undefined : Float16Array };',
    'const table = { F16: typeof Float16Array > "a" ? Float16Array : undefined };',
    'if (typeof Float16Array !== "undefined") new Float16Array(2)',
    'const C = globalThis.Float16Array; if (typeof C !== "undefined") new C(2)',
    'if (typeof Float16Array === "function") queueMicrotask(() => new Float16Array(2));',
    'if (typeof Float16Array === "function") Promise.withResolvers()',
  ])('keeps missing, wrong, shadowed and deferred guards red: %s', (source) => {
    expect(violations(source).length).toBeGreaterThan(0);
  });

  it('checks the actual emitted IPC codec and rejects removal of its constructor guard', () => {
    const source = readFileSync('packages/runtime-js/src/internal/node-ipc-advanced.ts', 'utf8');
    const emitted = transformSync(source, { loader: 'ts', target: 'es2022', minify: true }).code;
    expect(violations(emitted)).toEqual([]);
    const unguarded = source.replace("typeof Float16Array === 'function'", 'true');
    expect(unguarded).not.toBe(source);
    expect(
      violations(
        transformSync(unguarded, { loader: 'ts', target: 'es2022', minify: true }).code,
      ).join('\n'),
    ).toContain('Float16Array');
  });
});
