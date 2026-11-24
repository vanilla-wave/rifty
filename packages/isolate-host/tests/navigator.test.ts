/**
 * `navigator` / `Navigator` in the guest (backlog distribution/isolate-host-navigator-node-shape,
 * ADR-0557 §5 2026-11-24 line). Oracle: live `node -e` / `node <file>` of this Node
 * executable. Shape is byte-equal; values are the guest's own identity, related to
 * its `process`/`os`/`Intl` by Node's rules.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUEST_DIRS, MemoryFsSync, snapshotFs } from '../src/codec.ts';
import { createSandbox, runCode } from '../src/index.ts';
import { nodeEval, nodeSequence } from './support.ts';

/** One line per observable: descriptors, keys, brand checks, errors, inspect, global writes. */
const SHAPE = String.raw`
const out = [];
const p = (k, f) => { try { out.push(k + ' ' + JSON.stringify(f())) } catch (e) { out.push(k + ' THROW ' + e.name + ' ' + e.code + ' ' + e.message) } };
const fn = (x) => typeof x === 'function' ? 'fn ' + x.name + '/' + x.length : x === undefined ? 'undef' : typeof x;
const desc = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && Object.fromEntries(Object.entries(d).map(([a, v]) => [a, typeof v === 'function' ? fn(v) : typeof v === 'object' ? typeof v : v])) };
p('global', () => desc(globalThis, 'navigator'));
p('Navigator', () => desc(globalThis, 'Navigator'));
p('same', () => navigator === navigator);
p('own', () => Reflect.ownKeys(navigator));
p('protoKeys', () => Reflect.ownKeys(Navigator.prototype));
for (const k of Reflect.ownKeys(Navigator.prototype)) p('d.' + String(k), () => desc(Navigator.prototype, k));
p('protoDesc', () => desc(Navigator, 'prototype'));
p('protoProto', () => Object.getPrototypeOf(Navigator.prototype) === Object.prototype);
p('instanceof', () => [navigator instanceof Navigator, Object.getPrototypeOf(navigator) === Navigator.prototype, navigator.constructor === Navigator]);
p('class', () => [Navigator.name, Navigator.length, typeof Navigator]);
p('new', () => new Navigator());
p('newShape', () => { try { new Navigator() } catch (e) { return [e instanceof TypeError, e.name, e.message, e.code, desc(e, 'code'), Object.keys(e)] } });
p('call', () => Navigator());
for (const k of ['hardwareConcurrency', 'locks', 'language', 'languages', 'userAgent', 'platform']) p('brand.' + k, () => Object.getOwnPropertyDescriptor(Navigator.prototype, k).get.call({}));
p('inspect', () => require('util').inspect(navigator));
p('toString', () => Object.prototype.toString.call(navigator));
p('json', () => JSON.stringify(navigator));
p('keys', () => Object.keys(navigator));
p('forin', () => { const k = []; for (const x in navigator) k.push(x); return k });
p('spread', () => ({ ...navigator }));
p('types', () => ['hardwareConcurrency', 'language', 'languages', 'userAgent', 'platform'].map((k) => typeof navigator[k]));
p('languages', () => [Object.isFrozen(navigator.languages), navigator.languages === navigator.languages, Array.isArray(navigator.languages)]);
p('strictAssign', () => { 'use strict'; navigator = 1 });
p('sloppyAssign', () => { globalThis.navigator = 1; return typeof navigator });
p('hasOwn', () => [Object.hasOwn(globalThis, 'navigator'), 'navigator' in globalThis, Object.keys(globalThis).includes('navigator')]);
p('delete', () => [delete globalThis.navigator, typeof globalThis.navigator, typeof Navigator]);
console.log(out.join('\n'));
`;

/** Node's relations between navigator and the process identity (true in Node by construction). */
const RELATIONS = String.raw`
const os = require('os');
const v = process.version;
console.log(JSON.stringify({
  userAgent: navigator.userAgent === 'Node.js/' + v.slice(1, v.indexOf('.')),
  hardwareConcurrency: navigator.hardwareConcurrency === os.availableParallelism(),
  cpus: os.cpus().length === navigator.hardwareConcurrency,
  language: navigator.language === new Intl.DateTimeFormat().resolvedOptions().locale,
  languages: navigator.languages.length === 1 && navigator.languages[0] === navigator.language,
}));
`;

describe('navigator has Node 24 shape (parity cases 1–4)', () => {
  it('descriptors, keys, brand checks, illegal constructor, inspect and global writes equal node -e', async () => {
    const oracle = nodeEval(SHAPE);
    expect(oracle.code).toBe(0);
    expect(oracle.stdout).toContain('d.locks ');
    expect(await runCode(SHAPE)).toEqual({ stdout: oracle.stdout, stderr: '', exitCode: 0 });
  });

  it("the illegal constructor's error lacks Node's [ERR_ILLEGAL_CONSTRUCTOR] label and prototype (declared gap)", async () => {
    // runtime-js/node-error-code-label: every rifty-thrown Node error is a plain
    // TypeError + `code`; a fix turns this red (compat isolate-host.md row).
    const code =
      "try { new Navigator() } catch (e) { console.log(String(e)); console.log(e.stack.split('\\n')[0]); console.log(Object.getPrototypeOf(e) === TypeError.prototype) }";
    const label = 'TypeError [ERR_ILLEGAL_CONSTRUCTOR]: Illegal constructor\n';
    expect(nodeEval(code).stdout).toBe(`${label}${label}false\n`);
    const plain = 'TypeError: Illegal constructor\n';
    expect((await runCode(code)).stdout).toBe(`${plain}${plain}true\n`);
  });
});

describe("navigator values are the guest's identity (parity cases 5–7)", () => {
  it('userAgent, hardwareConcurrency, os.cpus(), language and languages relate to process/os/Intl as in Node', async () => {
    const oracle = nodeEval(RELATIONS);
    expect(oracle.stdout).toBe(
      `${JSON.stringify({ userAgent: true, hardwareConcurrency: true, cpus: true, language: true, languages: true })}\n`,
    );
    expect(await runCode(RELATIONS)).toEqual({ stdout: oracle.stdout, stderr: '', exitCode: 0 });
  });

  it("platform is Node's getNavigatorPlatform of the guest's process.arch/platform", async () => {
    const guest = await runCode(
      'console.log(JSON.stringify([process.arch, process.platform, navigator.platform]))',
    );
    expect(guest.exitCode).toBe(0);
    const [arch, platform, navigatorPlatform] = JSON.parse(guest.stdout) as string[];
    const rule = nodeEval(
      `console.log(require('internal/navigator').getNavigatorPlatform(${JSON.stringify(arch)}, ${JSON.stringify(platform)}))`,
      ['--expose-internals'],
    );
    expect(rule.code).toBe(0);
    expect(navigatorPlatform).toBe(rule.stdout.trim());
  });

  it("no host value: one thread (the isolate runs no Workers), the guest's version and platform", async () => {
    const guest = await runCode(
      "console.log(JSON.stringify([navigator.hardwareConcurrency, require('os').availableParallelism(), navigator.userAgent, process.version, navigator.platform, process.platform]))",
    );
    expect(JSON.parse(guest.stdout)).toEqual([
      1,
      1,
      'Node.js/24',
      'v24.0.0',
      'Rifty wasm',
      'rifty',
    ]);
  });
});

/** Every file of the installed core-js, keyed as `node_modules/core-js/<rel>`. */
function coreJsFiles(): Record<string, Uint8Array> {
  const root = join(import.meta.dirname, '../node_modules/core-js');
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, `${rel}/${name}`);
      else files[`${rel}/${name}`] = readFileSync(abs);
    }
  };
  walk(root, 'node_modules/core-js');
  return files;
}

// core-js reads `navigator.userAgent` at load (`internals/environment-user-agent`);
// it is inlined in many bundles (exceljs/dist/exceljs.min.js, pptxgenjs/dist/pptxgen.bundle.js).
const CORE_JS_MAIN = `require('core-js/actual');
console.log(JSON.stringify([
  require('core-js/internals/environment-user-agent'),
  require('core-js/internals/environment'),
  require('core-js/internals/environment-is-node'),
  [3, 1, 2].toSorted(),
]));
`;

describe('core-js loads in a sandbox (acceptance 2)', () => {
  it("require('core-js/actual') runs as under node <file> over the same node_modules", async () => {
    const files = { ...coreJsFiles(), 'main.js': new TextEncoder().encode(CORE_JS_MAIN) };
    const [oracle] = nodeSequence([{ files, run: ['main.js'] }]);
    expect(oracle?.exitCode).toBe(0);
    const fs = new MemoryFsSync();
    for (const dir of GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
    for (const [rel, data] of Object.entries(files)) {
      const path = `/workspace/${rel}`;
      fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      fs.writeFileSync(path, data);
    }
    const sb = await createSandbox({
      snapshot: snapshotFs(fs, { template: null, maxBytes: 64 * 2 ** 20 }),
    });
    try {
      expect(await sb.exec('main.js')).toEqual({
        stdout: oracle?.stdout,
        stderr: oracle?.stderr,
        exitCode: 0,
      });
    } finally {
      await sb.destroy();
    }
  }, 120_000);
});
