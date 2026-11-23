/**
 * ADR-0558 §1, §2, §6: the packed export
 * installs alone and brings no native addon; the README's custom-integration
 * block, with the consumer's own isolated-vm and nothing internal of rifty,
 * runs the isolate-host corpus like `node -e`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runCode } from '../../isolate-host/src/index.ts';
import { CORPUS, type Outcome, parityView } from '../../isolate-host/tests/corpus.ts';
import { nodeEval } from '../../isolate-host/tests/support.ts';

/**
 * Unhandled rejections whose reason isolated-vm cannot copy out: the guest
 * controls the reason, the embedder sends `UNCOPYABLE_REJECTION` instead.
 * Compared on stdout + status, as in `runCode` parity (Node's wording differs).
 */
const UNCOPYABLE = ['Promise.reject({ f() {} })', 'Promise.reject(Symbol())', 'Promise.reject(1)'];

const carrier = it;

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
/** isolated-vm as rifty's host installs it (7.0.2), resolved from that package. */
const WORKSPACE_IVM = dirname(
  createRequire(join(PACKAGE_DIR, '../isolate-host/package.json')).resolve(
    'isolated-vm/package.json',
  ),
);
const work = mkdtempSync(join(tmpdir(), 'isolate-guest-embedder-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const env = { PATH: process.env.PATH ?? '' };

let packed: string | undefined;
/** The export's tarball, packed once. */
function pack(): string {
  if (packed !== undefined) return packed;
  if (!existsSync(join(PACKAGE_DIR, 'package.json'))) throw new Error('no export package');
  const packDir = join(work, 'pack');
  execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: PACKAGE_DIR,
    stdio: 'pipe',
  });
  const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('no tarball');
  packed = join(packDir, tarball);
  return packed;
}

/** A clean project `name` with the packed export installed alone. */
function install(name: string): string {
  const app = join(work, name);
  if (existsSync(app)) return app;
  execFileSync('mkdir', ['-p', app]);
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ name: 'embedder', private: true, type: 'module' }),
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', pack()], { cwd: app, stdio: 'pipe' });
  return app;
}

/** `install(name)` plus the consumer's own isolated-vm and the README block as `embed.mjs`. */
function embedder(name: string): string {
  const app = join(work, name);
  if (existsSync(join(app, 'embed.mjs'))) return app;
  install(name);
  // The consumer's own isolated-vm 7.0.2: npm links the workspace's install (real
  // package bytes and binary, no registry access).
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--offline', WORKSPACE_IVM], {
    cwd: app,
    stdio: 'pipe',
  });
  const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8');
  const example = /```js\n([\s\S]*?)```/.exec(readme)?.[1];
  if (example === undefined) throw new Error('README has no js block');
  // Only the public export, the consumer's own isolated-vm and Node builtins.
  if (/createRequire|\brequire\s*\(/.test(example)) throw new Error('README embedder uses require');
  const specifiers = [...example.matchAll(/(?:from|import|resolve)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  );
  const foreign = specifiers.filter(
    (s) =>
      ![
        '@riftydev/isolate-guest',
        '@riftydev/isolate-guest/guest.js',
        'isolated-vm',
        'isolated-vm/package.json',
      ].includes(s as string) && !(s as string).startsWith('node:'),
  );
  if (foreign.length > 0) throw new Error(`README embedder imports ${foreign.join(', ')}`);
  writeFileSync(join(app, 'embed.mjs'), example);
  writeFileSync(
    join(app, 'driver.mjs'),
    `import { readFileSync } from 'node:fs';
import { run } from './embed.mjs';
const out = {};
for (const code of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  const { stdout, stderr, exitCode } = await run(code);
  out[code] = { stdout, stderr, exitCode };
}
process.stdout.write(JSON.stringify(out));
`,
  );
  return app;
}

/** The README embedder over `codes`, sequentially in one plain-node process that must exit by itself. */
function runEmbedder(
  name: string,
  codes: readonly string[],
  timeout = 180_000,
): Record<string, Outcome> {
  const app = embedder(name);
  writeFileSync(join(app, 'codes.json'), JSON.stringify(codes));
  const out = execFileSync(process.execPath, ['--no-node-snapshot', 'driver.mjs', 'codes.json'], {
    cwd: app,
    encoding: 'utf8',
    env,
    timeout,
  });
  return JSON.parse(out) as Record<string, Outcome>;
}

/** `import()` in every form `runCode` parity runs (ADR-0557 §5: ends the run, exit 1). */
const IMPORT_FORMS = [
  "import('node:fs')",
  "(async () => { const fs = await import('node:fs'); console.log('read') })()",
  'eval("import(\'node:fs\')")',
  'new Function("return import(\'node:fs\')")()',
  "import('node:fs').then(() => console.log('LOADED'), () => console.log('caught'))",
  "import('node:fs').catch(() => {}); process.exit(0)",
  "setTimeout(() => import('node:fs'), 5)",
  "console.log('before'); import('nope')",
  "import('x').catch((e) => console.log(String(e.stack)))",
  // Two requests: the gap line is written once.
  "import('a'); import('b')",
  // Output after the gap, synchronous and queued: never part of the result.
  "console.log('before'); import('nope'); console.log('after')",
  "import('x').catch(() => {}); for (let i = 0; i < 2000; i++) console.log(i)",
];

let ran: Record<string, Outcome> | undefined;
/** Corpus rows, uncopyable rejections and `import()` forms through the README embedder. */
function runCorpus(): Record<string, Outcome> {
  ran ??= runEmbedder('corpus', [...CORPUS.map((r) => r.code), ...UNCOPYABLE, ...IMPORT_FORMS]);
  return ran;
}

describe('the packed export (ADR-0558 §1)', () => {
  carrier(
    'installs alone, declares no dependency, imports and resolves its bundle without isolated-vm',
    async () => {
      const app = install('alone');
      const manifest = JSON.parse(
        readFileSync(join(app, 'node_modules/@riftydev/isolate-guest/package.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(manifest.dependencies ?? {}).toEqual({});
      expect(manifest.peerDependencies ?? {}).toEqual({});
      expect(manifest.optionalDependencies ?? {}).toEqual({});
      expect(existsSync(join(app, 'node_modules/isolated-vm'))).toBe(false);
      const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
      expect(['preinstall', 'install', 'postinstall'].filter((k) => k in scripts)).toEqual([]);
      const files = (
        readdirSync(join(app, 'node_modules/@riftydev/isolate-guest'), {
          recursive: true,
        }) as string[]
      ).filter((f) => f.endsWith('.node'));
      expect(files).toEqual([]);
      const probe = `
      const root = await import('@riftydev/isolate-guest');
      const { statSync } = await import('node:fs');
      const bundle = statSync(new URL(import.meta.resolve('@riftydev/isolate-guest/guest.js')));
      const native = process.report.getReport().sharedObjects.filter((p) => p.endsWith('.node'));
      console.log(JSON.stringify({ exports: Object.keys(root).sort(), bundle: bundle.size > 1e6, native }));`;
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: app,
        encoding: 'utf8',
        env,
      });
      expect(JSON.parse(out)).toEqual({
        // ADR-0558 dated line 2026-11-22: the snapshot exports (ADR-0567).
        exports: [
          'FsSnapshotError',
          'IMPORT_GAP',
          'UNCOPYABLE_REJECTION',
          'createHostBridge',
          'exitStatus',
          'restoreFs',
          'snapshotFs',
        ],
        bundle: true,
        native: [],
      });
    },
    240_000,
  );
});

describe('the README embedder runs the corpus like node -e (ADR-0558 §2, §6)', () => {
  for (const row of CORPUS) {
    const test = row.ceiling === undefined ? carrier : it.fails;
    test(row.ceiling === undefined
      ? row.label
      : `${row.label} — ceiling: ${row.ceiling}`, async () => {
      const raw = nodeEval(row.code);
      expect(raw.signal, 'oracle must exit on its own').toBeNull();
      const result = runCorpus()[row.code];
      expect(result).toBeDefined();
      expect(parityView(row, result as Outcome)).toEqual(
        parityView(row, { stdout: raw.stdout, stderr: raw.stderr, exitCode: raw.code }),
      );
    }, 240_000);
  }
});

describe('unhandled rejections with uncopyable reasons fail the run as in Node (ADR-0558 §6)', () => {
  for (const code of UNCOPYABLE) {
    carrier(
      code,
      async () => {
        const oracle = nodeEval(code);
        const result = runCorpus()[code];
        expect({ stdout: result?.stdout, exitCode: result?.exitCode }).toEqual({
          stdout: oracle.stdout,
          exitCode: oracle.code,
        });
      },
      240_000,
    );
  }
});

describe("declared ceilings read as runCode's (ADR-0557 §5, §6)", () => {
  // The built-in host is the reference for rifty's own declared behavior: the
  // import() gap (stderr line, exit 1, nothing the guest does after it, no host
  // path) and the uncopyable-rejection diagnostic must not depend on the embedder.
  for (const code of [...IMPORT_FORMS, ...UNCOPYABLE]) {
    carrier(
      code,
      async () => {
        const hosted = await runCode(code);
        expect(runCorpus()[code]).toEqual({
          stdout: hosted.stdout,
          stderr: hosted.stderr,
          exitCode: hosted.exitCode,
        });
        expect(JSON.stringify(runCorpus()[code])).not.toMatch(/file:|node_modules|embed\.mjs/);
      },
      240_000,
    );
  }
});

describe('the README embedder ends each call (ADR-0558 §2, §3)', () => {
  // A host interval still armed when the guest exits: without `close()` the
  // embedder's process never exits and the driver times out.
  carrier(
    'a guest interval pending at exit leaves no host timer behind',
    () => {
      const code = "setInterval(() => {}, 5); console.log('x'); process.exit(0)";
      expect(runEmbedder('corpus', [code], 20_000)[code]).toEqual({
        stdout: 'x\n',
        stderr: '',
        exitCode: 0,
      });
    },
    240_000,
  );
});

describe('each call has its own clock (ADR-0558 Decisions 2026-11-18)', () => {
  // A fresh `node -e` starts its clock near 0; two in-process calls must not
  // read the embedder's uptime nor each other's.
  carrier(
    'performance.now() restarts with every call in one process',
    () => {
      const first =
        "const e = Date.now() + 1200; while (Date.now() < e); console.log('a', performance.now() < 2000)";
      const second =
        "console.log('b', performance.now() < 1000, Math.abs(performance.timeOrigin + performance.now() - Date.now()) < 50)";
      const out = runEmbedder('corpus', [first, second]);
      expect([out[first]?.stdout, out[second]?.stdout]).toEqual(['a true\n', 'b true true\n']);
      expect(nodeEval(second).stdout).toBe('b true true\n');
    },
    240_000,
  );
});

describe('the README embedder refuses isolated-vm < 7 (ADR-0558 §6)', () => {
  // 6.x lacks both hooks and ignores unknown options: a silently wrong result.
  // A stand-in package carries only the version the example reads.
  carrier(
    'importing it throws, naming the version',
    () => {
      const app = install('v6');
      const ivm = join(app, 'node_modules/isolated-vm');
      execFileSync('mkdir', ['-p', ivm]);
      writeFileSync(
        join(ivm, 'package.json'),
        JSON.stringify({ name: 'isolated-vm', version: '6.2.0', main: 'index.js' }),
      );
      writeFileSync(join(ivm, 'index.js'), 'module.exports = {};');
      const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8');
      writeFileSync(join(app, 'embed.mjs'), /```js\n([\s\S]*?)```/.exec(readme)?.[1] ?? '');
      let error = '';
      try {
        execFileSync(
          process.execPath,
          ['--input-type=module', '-e', "await import('./embed.mjs')"],
          {
            cwd: app,
            env,
            stdio: 'pipe',
          },
        );
      } catch (e) {
        error = String((e as { stderr?: Buffer }).stderr);
      }
      expect(error).toContain('isolated-vm 6.2.0: need >= 7');
    },
    240_000,
  );
});

describe('the README states the contract (ADR-0558 §2)', () => {
  // The prose is review-read; this pins that every contract name is documented.
  carrier(
    'names every bridge function, both guest entry points, both embedder hooks and the unstable status',
    () => {
      const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8');
      const names = [
        'write',
        'timerStart',
        'timerClear',
        'now',
        'random',
        'timeOrigin',
        'run',
        'fire',
        'rejection',
        'onUnhandledRejection',
        'importModuleDynamically',
        'UNCOPYABLE_REJECTION',
        'IMPORT_GAP',
        'exitStatus',
        'close',
      ];
      expect(
        names.filter((n) => !readme.includes(`\`${n}\``) && !readme.includes(`\`${n}(`)),
      ).toEqual([]);
      for (const version of ['7.0.2', '6.2.0']) expect(readme).toContain(version);
      expect(readme).toMatch(/unstable/i);
    },
  );
});

it('the packed README embedder selects shared buffers per fresh guest', () => {
  const app = embedder('shared-buffers');
  const code = `if (typeof SharedArrayBuffer === 'undefined') console.log('fallback');
    else console.log(new SharedArrayBuffer(4).byteLength);`;
  const driver = `import { run } from './embed.mjs';
    for (const options of [{allowSharedArrayBuffer: false}, undefined, {allowSharedArrayBuffer: true}]) {
      console.log(JSON.stringify(await run(${JSON.stringify(code)}, options)));
    }
    try { await run('0', {allowSharedArrayBuffer: 'false'}); }
    catch (e) { console.log(JSON.stringify(e.message)); }`;
  const results = execFileSync(
    process.execPath,
    ['--no-node-snapshot', '--input-type=module', '-e', driver],
    {
      cwd: app,
      encoding: 'utf8',
      env,
      timeout: 30_000,
    },
  )
    .trim()
    .split('\n')
    .map((line): unknown => JSON.parse(line));
  expect(results.pop()).toBe('isolate-host guest: allowSharedArrayBuffer must be a boolean');
  expect(results).toEqual(
    [nodeEval(code, ['--enable-sharedarraybuffer-per-context']).stdout, '4\n', '4\n'].map(
      (stdout) => ({
        stdout,
        stderr: '',
        exitCode: 0,
      }),
    ),
  );
});

it('pins the wasm memory API and checks each buffer producer with guest intrinsics replaced', () => {
  // Node 24 exposes these methods under a V8 flag. Newer engines enable them by default.
  const flags =
    'toResizableBuffer' in WebAssembly.Memory.prototype
      ? []
      : ['--experimental-wasm-rab-integration'];
  const ordinary = `const memory = new WebAssembly.Memory({initial: 1, maximum: 2});
    for (const name of ['toFixedLengthBuffer', 'toResizableBuffer']) {
      const fn = memory[name];
      console.log(fn.name, Object.hasOwn(fn, 'prototype'), memory[fn.name]().byteLength);
      try { Reflect.construct(Object, [], fn); console.log('constructable') }
      catch (e) { console.log(e.name) }
    }`;
  const oracle = execFileSync(process.execPath, [...flags, '-e', ordinary], { encoding: 'utf8' });
  const code = `${ordinary}
  console.log(Reflect.ownKeys(WebAssembly.Memory.prototype).map(String).sort().join(','));
  for (const shared of [false, true]) {
    const memory = new WebAssembly.Memory({initial: 1, maximum: 2, shared});
    for (const key of ['buffer', 'toFixedLengthBuffer', 'toResizableBuffer']) {
      const tag = Object.prototype.toString;
      const apply = Reflect.apply;
      const length = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength');
      let lookups = 0;
      let result, error;
      try {
        const unexpected = () => { lookups++; throw Error('late lookup') };
        Object.prototype.toString = Reflect.apply = unexpected;
        Object.defineProperty(ArrayBuffer, Symbol.hasInstance, {configurable: true, value: unexpected});
        Object.defineProperty(ArrayBuffer.prototype, 'byteLength', {...length, get: unexpected});
        result = key === 'buffer' ? memory.buffer : memory[key]();
      } catch (e) { error = e }
      finally {
        delete ArrayBuffer[Symbol.hasInstance];
        Object.defineProperty(ArrayBuffer.prototype, 'byteLength', length);
        Object.prototype.toString = tag;
        Reflect.apply = apply;
      }
      console.log(lookups, error ? error.name + ' ' + error.feature : tag.call(result));
    }
  }`;
  const driver = `import { run } from './embed.mjs';
    console.log(JSON.stringify(await run(${JSON.stringify(code)}, {allowSharedArrayBuffer: false})))`;
  const output = execFileSync(
    process.execPath,
    [...flags, '--no-node-snapshot', '--input-type=module', '-e', driver],
    {
      cwd: embedder('shared-buffers'),
      encoding: 'utf8',
      env,
      timeout: 30_000,
    },
  );
  const raw = JSON.parse(output) as Outcome;
  expect(raw).toEqual({
    stdout: [
      oracle,
      'Symbol(Symbol.toStringTag),buffer,constructor,grow,toFixedLengthBuffer,toResizableBuffer\n',
      '0 [object ArrayBuffer]\n'.repeat(3),
      '0 NotImplementedError isolate-host.SharedArrayBuffer\n'.repeat(3),
    ].join(''),
    stderr: '',
    exitCode: 0,
  });
});

it('the restricted bundle removes the global and guards wasm before runtime imports capture them', () => {
  // Observe the original binding from the embedder before running any bundle code.
  // Each observer forwards to V8 so the bundle sees real constructors and exports.
  const driver = `import ivm from 'isolated-vm';
    import { readFileSync } from 'node:fs';
    import { createHostBridge } from '@riftydev/isolate-guest';
    const bundle = readFileSync(new URL(import.meta.resolve('@riftydev/isolate-guest/guest.js')), 'utf8');
    for (const flag of [false, true]) {
      const isolate = new ivm.Isolate();
      const context = isolate.createContextSync();
      const bridge = createHostBridge({ write() {}, fire() {} });
      try {
        context.evalSync(\`let reads = 0, rawMemoryLookups = 0, earlyExports = 0;
          (() => {
            const Memory = WebAssembly.Memory;
            const nativeGet = Object.getOwnPropertyDescriptor(Memory.prototype, 'buffer').get;
            const guardPending = () =>
              Object.getOwnPropertyDescriptor(Memory.prototype, 'buffer').get === nativeGet;
            const instance = WebAssembly.Instance.prototype;
            const exportsDescriptor = Object.getOwnPropertyDescriptor(instance, 'exports');
            Object.defineProperty(instance, 'exports', {
              ...exportsDescriptor, get() {
                if (guardPending()) earlyExports++;
                return exportsDescriptor.get.call(this);
              }
            });
            Object.defineProperty(WebAssembly, 'Memory', {
              configurable: true, get() {
                if (guardPending()) rawMemoryLookups++;
                return Memory;
              }
            });
            const original = SharedArrayBuffer;
            Object.defineProperty(globalThis, 'SharedArrayBuffer', {
              configurable: true, get() { reads++; return original; }
            });
          })();
          globalThis.__riftyIsolateHost = { allowSharedArrayBuffer: \${flag}, timeOrigin: \${bridge.timeOrigin} };
        \`);
        const record = context.global.getSync('__riftyIsolateHost', {reference: true});
        for (const [key, fn] of Object.entries(bridge.functions)) record.setSync(key, new ivm.Callback(fn));
        isolate.compileScriptSync(bundle).runSync(context);
        console.log(context.evalSync('reads > 0'));
        if (!flag) console.log(context.evalSync('JSON.stringify([rawMemoryLookups, earlyExports])'));
      } finally { bridge.close(); isolate.dispose(); }
    }`;
  const output = execFileSync(
    process.execPath,
    ['--no-node-snapshot', '--input-type=module', '-e', driver],
    {
      cwd: embedder('shared-buffers'),
      encoding: 'utf8',
      env,
      timeout: 30_000,
    },
  );
  // The shim itself looks up Memory once to replace its native buffer getter.
  expect(output).toBe('false\n[1,0]\ntrue\n');
});
