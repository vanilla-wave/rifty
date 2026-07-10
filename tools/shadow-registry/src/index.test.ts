import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as realEsbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { bakedOverrides, internalsShims } from './index.ts';

describe('shadow-registry', () => {
  it('bakedOverrides contains the bcrypt → bcryptjs entry', () => {
    expect(bakedOverrides.bcrypt).toBe('bcryptjs');
  });

  it('bakedOverrides replaces esbuild with the WASI artifact', () => {
    expect(bakedOverrides.esbuild).toBe('@esbuild/wasi-preview1@0.28.0');
  });

  it('bakedOverrides replaces lightningcss with the WASM artifact', () => {
    expect(bakedOverrides.lightningcss).toBe('lightningcss-wasm@1.32.0');
  });

  it('internalsShims are keyed by installed trigger with package-relative file paths', () => {
    expect(Object.keys(internalsShims).sort()).toEqual([
      '@esbuild/wasi-preview1',
      'lightningcss-wasm',
      'rollup',
    ]);
    for (const shim of Object.values(internalsShims)) {
      expect(shim.range.length).toBeGreaterThan(0);
      for (const rel of Object.keys(shim.files)) {
        // Relative, in-package paths only — the installer anchors them at the
        // resolved installPath (never a hardcoded /workspace root).
        expect(rel.startsWith('/')).toBe(false);
        expect(rel).not.toContain('..');
        expect(rel).not.toContain('node_modules');
      }
    }
  });

  it('rollup shim is ONE mode-independent file delegating to the real WASM parser', () => {
    const rollup = internalsShims.rollup;
    expect(rollup?.range).toBe('^4.0.0');
    const native = rollup?.files['dist/native.js'] ?? '';
    expect(native).toContain("require('@rollup/wasm-node/dist/native.js')");
    expect(native).toContain('exports.parse = native.parse');
    expect(native).toContain('exports.parseAsync = native.parseAsync');
    expect(native).toContain('exports.xxhashBase64Url = native.xxhashBase64Url');
    expect(native).toContain('exports.xxhashBase36 = native.xxhashBase36');
    expect(native).toContain('exports.xxhashBase16 = native.xxhashBase16');
    // The dev empty-Program stub is gone (ADR-0188) — no fallback, no mode split.
    expect(native).not.toContain('emptyProgram');
  });

  it('rollup shim companion-pins @rollup/wasm-node in lockstep', () => {
    expect(internalsShims.rollup?.companions).toEqual(['@rollup/wasm-node']);
  });

  it('esbuild alias shim delegates the REAL esbuild JS API to the host bridge (ADR-0192)', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    expect(shim?.into).toBe('esbuild');
    expect(shim?.files['package.json']).toContain('"esbuild"');
    // Contract renegotiated (PR#125 F1): the delegating body lives ONLY in
    // lib/main.cjs now — lib/main.js is a thin re-export wrapper, so the
    // behavior markers are asserted on the single body.
    const main = shim?.files['lib/main.cjs'] ?? '';
    expect(main).toContain('globalThis.__riftyEsbuild');
    for (const member of ['transform', 'build', 'context', 'formatMessages', 'analyzeMetafile']) {
      expect(main).toContain(`hostEsbuild().${member}(`);
    }
    // stop() must NOT delegate: the host esbuild-wasm service is shared
    // realm-wide (vite's own transforms ride it); real-Node stop() only kills
    // the caller's OWN child service — the shim resets its local gate instead.
    expect(main).not.toContain('hostEsbuild().stop(');
    // esbuild-wasm has no synchronous API in a browser realm — loud throws.
    for (const feature of [
      'esbuild.transformSync',
      'esbuild.buildSync',
      'esbuild.formatMessagesSync',
      'esbuild.analyzeMetafileSync',
    ]) {
      expect(main).toContain(`NotImplementedError('${feature}'`);
    }
    // The partial emulations are gone: no transform-only build(), no
    // empty-only context stub, no WASI transform bridge global.
    expect(main).not.toContain('loadEntryThroughPlugins');
    expect(main).not.toContain('__riftyEsbuildTransform');
    expect(main).not.toContain('rebuild: async () => ({');
  });

  it('esbuild alias version matches the bakedOverrides trigger pin exactly (no lying metadata)', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const pinned = bakedOverrides.esbuild?.split('@').at(-1);
    const pkg = JSON.parse(shim?.files['package.json'] ?? '{}') as { version?: string };
    // The alias package.json + the shim's `version` export are STATIC claims;
    // they must equal the version the override actually installs, and the
    // exact-pin range must refuse any drifted trigger at install time.
    expect(pkg.version).toBe(pinned);
    // PR#125 F1: the `version` claim lives in the single CJS body.
    expect(shim?.files['lib/main.cjs']).toContain(`const version = "${pinned}"`);
    expect(shim?.range).toBe(pinned);
  });

  it('esbuild alias serves BOTH module systems: ESM entry + CJS entry (require("esbuild") is real Node behavior)', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const pkg = JSON.parse(shim?.files['package.json'] ?? '{}') as {
      main?: string;
      exports?: Record<string, Record<string, string>>;
    };
    // `type: module` classifies lib/main.js as ESM; a require condition pointing
    // there would loud-fail sync require() in the rifty loader — the require
    // entry must be a real .cjs file (the lightningcss shim pattern).
    expect(pkg.exports?.['.']?.import).toBe('./lib/main.js');
    expect(pkg.exports?.['.']?.require).toBe('./lib/main.cjs');
    expect(pkg.main).toBe('./lib/main.cjs');
    const esm = shim?.files['lib/main.js'] ?? '';
    const cjs = shim?.files['lib/main.cjs'] ?? '';
    expect(esm).toContain('export default');
    expect(esm).not.toContain('module.exports');
    expect(cjs).toContain('module.exports');
    expect(cjs).not.toContain('export default');
    // Contract renegotiated (PR#125 F1): the old assert pinned "same body in
    // BOTH entries" — but two body copies meant two initialize/stop gates in
    // one realm, while real esbuild is one CJS singleton (import().default ===
    // require('esbuild'), probe-verified). The no-drift intent is now served
    // structurally: ONE stateful body (main.cjs), ESM entry a thin re-export.
    expect(cjs).toContain('globalThis.__riftyEsbuild');
    expect(esm).not.toContain('globalThis.__riftyEsbuild');
    expect(esm).toContain("from './main.cjs'");
  });

  it('lightningcss alias shim delegates both entrypoints to lightningcss-wasm', () => {
    const shim = internalsShims['lightningcss-wasm'];
    expect(shim?.into).toBe('lightningcss');
    expect(shim?.files['package.json']).toContain('"lightningcss"');
    expect(shim?.files['index.mjs']).toContain("from 'lightningcss-wasm'");
    expect(shim?.files['index.cjs']).toContain("require('lightningcss-wasm')");
  });
});

interface ShimContext {
  readonly rebuild: () => Promise<unknown>;
  readonly watch: (options?: object) => Promise<unknown>;
  readonly serve: (options?: object) => Promise<unknown>;
  readonly cancel: () => Promise<unknown>;
  readonly dispose: () => Promise<unknown>;
}

interface EsbuildShimApi {
  readonly version: string;
  readonly initialize: (options?: unknown) => Promise<void>;
  readonly transform: (input: string, options?: object) => Promise<{ code: string }>;
  readonly build: (opts: object) => Promise<unknown>;
  readonly context: (opts: object) => Promise<ShimContext>;
  readonly transformSync: (input: string, options?: object) => unknown;
  readonly buildSync: (opts: object) => unknown;
  readonly stop: () => Promise<void>;
}

/** Structural subset shared by the shim and REAL esbuild for lifecycle parity. */
interface EsbuildLifecycleApi {
  readonly context: (options: object) => Promise<ShimContext>;
  readonly transform: (input: string, options?: object) => Promise<unknown>;
  readonly stop: () => Promise<void>;
}

function loadCjsShim(): EsbuildShimApi {
  const cjs = internalsShims['@esbuild/wasi-preview1']?.files['lib/main.cjs'] ?? '';
  const module = { exports: {} };
  new Function('module', 'exports', cjs)(module, module.exports);
  return module.exports as EsbuildShimApi;
}

const withHost = async (
  host: object,
  run: (esbuild: EsbuildShimApi) => Promise<void>,
): Promise<void> => {
  const g = globalThis as { __riftyEsbuild?: unknown };
  g.__riftyEsbuild = host;
  try {
    await run(loadCjsShim());
  } finally {
    g.__riftyEsbuild = undefined;
  }
};

// Minimal valid wasm binary (magic + version) — a REAL WebAssembly.Module
// passes real esbuild's type check and reaches the truthy browser-only throw.
const EMPTY_WASM = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function throwMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('expected a synchronous throw');
}

describe('esbuild shim behavior (CJS body executed)', () => {
  it('delegates transform/build/context untouched to the host instance', async () => {
    const calls: Array<{ member: string; args: unknown[] }> = [];
    const record =
      (member: string) =>
      (...args: unknown[]) => {
        calls.push({ member, args });
        return Promise.resolve({ member });
      };
    await withHost(
      { transform: record('transform'), build: record('build'), context: record('context') },
      async (esbuild) => {
        const options = { entryPoints: ['a.ts'], bundle: true, plugins: [{ name: 'p' }] };
        // No initialize() first — real Node esbuild auto-spawns the service on
        // any API call (ensureServiceIsRunning); the shim must not gate on it.
        await esbuild.transform('const x = 1', { loader: 'ts' });
        await esbuild.build(options);
        await esbuild.context(options);
        expect(calls.map((c) => c.member)).toEqual(['transform', 'build', 'context']);
        // Same object references cross the bridge — JS plugins stay callable.
        expect(calls[1]?.args[0]).toBe(options);
        expect(calls[2]?.args[0]).toBe(options);
      },
    );
  });

  it('API calls without the installed host bridge fail loud (sync, fail-fast) with the wiring hint', () => {
    const esbuild = loadCjsShim();
    expect(() => esbuild.transform('x')).toThrow(/installEsbuildBridge/);
    expect(() => esbuild.build({})).toThrow(/installEsbuildBridge/);
  });

  it('initialize rejects browser-only options SYNC with real esbuild per-option messages; second call throws', async () => {
    let hostInits = 0;
    await withHost(
      {
        initialize: () => {
          hostInits += 1;
          return Promise.resolve();
        },
      },
      async (esbuild) => {
        // Real Node esbuild throws synchronously (main.js initialize validates
        // before returning a promise) — one exact message per option.
        expect(() => esbuild.initialize({ wasmURL: 'x.wasm' })).toThrow(
          'The "wasmURL" option only works in the browser',
        );
        expect(() =>
          esbuild.initialize({ wasmModule: new WebAssembly.Module(EMPTY_WASM) }),
        ).toThrow('The "wasmModule" option only works in the browser');
        expect(() => esbuild.initialize({ worker: true })).toThrow(
          'The "worker" option only works in the browser',
        );
        expect(hostInits).toBe(0);
        await esbuild.initialize();
        expect(hostInits).toBe(1);
        expect(() => esbuild.initialize()).toThrow('Cannot call "initialize" more than once');
      },
    );
  });

  it('initialize accepts {worker:false} (truthy check, real parity) and null options (options||{})', async () => {
    let hostInits = 0;
    await withHost(
      {
        initialize: () => {
          hostInits += 1;
          return Promise.resolve();
        },
      },
      async (esbuild) => {
        await esbuild.initialize({ worker: false });
        expect(hostInits).toBe(1);
      },
    );
    await withHost({ initialize: () => Promise.resolve() }, async (esbuild) => {
      await esbuild.initialize(null);
    });
  });

  it('initialize type-checks options and rejects unknown keys (validateInitializeOptions parity)', () => {
    // Validation precedes host access — no bridge installed, throws are sync.
    const esbuild = loadCjsShim();
    expect(() => esbuild.initialize({ wasmURL: 123 })).toThrow(
      '"wasmURL" must be a string or a URL',
    );
    expect(() => esbuild.initialize({ wasmModule: {} })).toThrow(
      '"wasmModule" must be a WebAssembly.Module',
    );
    expect(() => esbuild.initialize({ worker: 'yes' })).toThrow('"worker" must be a boolean');
    expect(() => esbuild.initialize({ notAnOption: 1 })).toThrow(
      'Invalid option in initialize() call: "notAnOption"',
    );
  });

  it('stop() resets the initialize gate and NEVER stops the shared host service', async () => {
    let hostInits = 0;
    let hostStops = 0;
    await withHost(
      {
        initialize: () => {
          hostInits += 1;
          return Promise.resolve();
        },
        stop: () => {
          hostStops += 1;
          return Promise.resolve();
        },
      },
      async (esbuild) => {
        await esbuild.initialize();
        expect(() => esbuild.initialize()).toThrow(/more than once/);
        // Real Node: stopService() resets initializeWasCalled — initialize is
        // legal again and the service respawns transparently on next API call.
        await esbuild.stop();
        await esbuild.initialize();
        expect(hostInits).toBe(2);
        // Host esbuild-wasm service is shared realm-wide — one guest's stop()
        // must never kill it (real Node: per-process child services).
        expect(hostStops).toBe(0);
      },
    );
  });

  it('stop() needs no host bridge (it owns no host service to stop)', async () => {
    const esbuild = loadCjsShim();
    await expect(esbuild.stop()).resolves.toBeUndefined();
  });

  it('stop() kills pre-stop contexts (dead-channel rejects, host ctx disposed best-effort) without touching the shared host service', async () => {
    const hostCalls: string[] = [];
    const hostCtx = {
      rebuild: () => {
        hostCalls.push('ctx.rebuild');
        return Promise.resolve({});
      },
      dispose: () => {
        hostCalls.push('ctx.dispose');
        return Promise.resolve(undefined);
      },
    };
    await withHost(
      {
        context: () => Promise.resolve(hostCtx),
        transform: () => Promise.resolve({ code: '' }),
        stop: () => {
          hostCalls.push('stop');
          return Promise.resolve(undefined);
        },
      },
      async (esbuild) => {
        const ctx = await esbuild.context({});
        await esbuild.stop();
        // Real esbuild channel semantics (probe-verified, 0.28.0): FIRST
        // request on the dead channel gets the write-failure flush message,
        // later ones the settled early-return; rebuild memoizes its rejection.
        await expect(ctx.rebuild()).rejects.toThrow(
          'The service was stopped: Cannot call write after a stream was destroyed',
        );
        await expect(ctx.rebuild()).rejects.toThrow(
          'The service was stopped: Cannot call write after a stream was destroyed',
        );
        await expect(ctx.watch()).rejects.toThrow(
          'The service is no longer running: Cannot call write after a stream was destroyed',
        );
        await expect(ctx.serve()).rejects.toThrow(
          'The service is no longer running: Cannot call write after a stream was destroyed',
        );
        await expect(ctx.cancel()).resolves.toBeUndefined();
        await expect(ctx.dispose()).resolves.toBeUndefined();
        // transform keeps working after stop (real esbuild respawns the
        // service; the shim's host service never died).
        await esbuild.transform('let x = 1');
        // A context created AFTER stop() is live again.
        const fresh = await esbuild.context({});
        await expect(fresh.rebuild()).resolves.toEqual({});
        // Host boundary: stop() disposed the old host ctx exactly once and
        // NEVER called host stop(); dead-ctx calls never reached the host.
        expect(hostCalls).toEqual(['ctx.dispose', 'ctx.rebuild']);
      },
    );
  });

  it('initialize can retry after a failed host initialization', async () => {
    let hostInits = 0;
    await withHost(
      {
        initialize: () => {
          hostInits += 1;
          return hostInits === 1
            ? Promise.reject(new Error('wasm fetch failed'))
            : Promise.resolve();
        },
      },
      async (esbuild) => {
        await expect(esbuild.initialize()).rejects.toThrow('wasm fetch failed');
        await esbuild.initialize();
        expect(hostInits).toBe(2);
        expect(() => esbuild.initialize()).toThrow(/more than once/);
      },
    );
  });

  it('sync APIs loud-throw (esbuild-wasm has no synchronous API in a browser realm)', () => {
    const esbuild = loadCjsShim();
    expect(() => esbuild.transformSync('x')).toThrow(/esbuild\.transformSync/);
    expect(() => esbuild.buildSync({})).toThrow(/esbuild\.buildSync/);
  });
});

// --- entry-style harness: writes a package into <tmp>/node_modules/esbuild and
// runs a probe in a REAL `node` child — the only faithful way to execute the
// generated ESM entry against Node's actual ESM↔CJS interop (vitest's
// transform pipeline would substitute its own interop semantics).
interface EntryStyleProbe {
  readonly defaultIsCjs: boolean;
  readonly namedInitializeIsCjs: boolean;
  readonly secondInitAcrossPaths: { ok?: boolean; err?: string };
}

const ENTRY_STYLE_PROBE = `import { createRequire } from 'node:module';
// Inert for the real package; the shim reads it lazily on API use only.
globalThis.__riftyEsbuild = { initialize: () => Promise.resolve() };
const require = createRequire(import.meta.url);
const cjs = require('esbuild');
const esm = await import('esbuild');
const out = {
  defaultIsCjs: esm.default === cjs,
  namedInitializeIsCjs: esm.initialize === cjs.initialize,
};
await esm.default.initialize();
try {
  cjs.initialize();
  out.secondInitAcrossPaths = { ok: true };
} catch (err) {
  out.secondInitAcrossPaths = { err: err.message };
}
await cjs.stop();
console.log(JSON.stringify(out));
`;

function probeEntryStyles(materialize: (pkgDir: string) => void): EntryStyleProbe {
  const dir = mkdtempSync(join(tmpdir(), 'rifty-esbuild-shim-'));
  try {
    materialize(join(dir, 'node_modules', 'esbuild'));
    const probePath = join(dir, 'probe.mjs');
    writeFileSync(probePath, ENTRY_STYLE_PROBE);
    const stdout = execFileSync(process.execPath, [probePath], { encoding: 'utf8' });
    return JSON.parse(stdout) as EntryStyleProbe;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeShimPackage(pkgDir: string): void {
  const files = internalsShims['@esbuild/wasi-preview1']?.files ?? {};
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(pkgDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

function linkRealPackage(pkgDir: string): void {
  mkdirSync(dirname(pkgDir), { recursive: true });
  const realDir = dirname(dirname(createRequire(import.meta.url).resolve('esbuild')));
  symlinkSync(realDir, pkgDir, 'dir');
}

type Outcome = { ok: true } | { err: string };
const outcome = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    return { err: err instanceof Error ? err.message : String(err) };
  }
};

const CTX_OPTIONS = { entryPoints: [], bundle: false, write: false, logLevel: 'silent' };

// One script, both sides: contexts die with stop() (two-phase dead-channel
// rejects, channel shared by sibling contexts, cancel/dispose stay silent)
// while transform and NEW contexts keep working (service respawn).
async function postStopLifecycle(api: EsbuildLifecycleApi): Promise<Record<string, Outcome>> {
  const out: Record<string, Outcome> = {};
  // Generation 1: two contexts on one service channel; rebuild goes first.
  const a = await api.context(CTX_OPTIONS);
  const b = await api.context(CTX_OPTIONS);
  await api.stop();
  out.rebuildFirst = await outcome(() => a.rebuild());
  out.rebuildReplay = await outcome(() => a.rebuild());
  out.watchNext = await outcome(() => a.watch());
  out.serveNext = await outcome(() => a.serve());
  out.cancelOnDead = await outcome(() => a.cancel());
  out.disposeOnDead = await outcome(() => a.dispose());
  out.siblingCtxRebuild = await outcome(() => b.rebuild());
  // Generation 2: cancel first — it flips the dead channel yet resolves.
  const c = await api.context(CTX_OPTIONS);
  await api.stop();
  out.cancelFirst = await outcome(() => c.cancel());
  out.rebuildAfterCancelFlip = await outcome(() => c.rebuild());
  // Post-stop, the API itself stays alive: transform + a fresh context work.
  out.transformAfterStop = await outcome(() => api.transform('let x = 1'));
  const d = await api.context(CTX_OPTIONS);
  out.newContextRebuild = await outcome(() => d.rebuild());
  await d.dispose();
  return out;
}

// The shim is a SECOND implementation of esbuild's Node lifecycle surface —
// pinning shim behavior against itself froze past drift in place. This oracle
// runs the REAL node esbuild package (devDep, 0.28.0 lockstep with the shim
// pin) side by side, so any future upstream lifecycle change fails HERE
// instead of drifting silently.
describe('esbuild shim vs REAL esbuild oracle (lifecycle parity)', () => {
  const realInitialize = realEsbuild.initialize as unknown as (options?: unknown) => Promise<void>;

  it('bad initialize options: shim message EQUALS the real one (sync throw, service-free)', () => {
    // Real esbuild validates before spawning anything — every case below
    // throws synchronously with zero child processes. Covers type errors,
    // unknown keys, and the truthy browser-only rejections.
    const shim = loadCjsShim();
    const badOptions: object[] = [
      { wasmURL: 'x.wasm' },
      { wasmModule: new WebAssembly.Module(EMPTY_WASM) },
      { worker: true },
      { wasmURL: 123 },
      { wasmModule: {} },
      { worker: 'yes' },
      { notAnOption: 1 },
    ];
    for (const options of badOptions) {
      expect(throwMessage(() => shim.initialize(options))).toBe(
        throwMessage(() => realInitialize(options)),
      );
    }
  });

  it('lifecycle: {worker:false}/null accepted, stop() re-permits initialize — BOTH sides', async () => {
    // Real side spawns the actual esbuild child service (unref-ed, killed by
    // stop()); stop() again in finally so nothing outlives the test.
    try {
      await realInitialize({ worker: false });
      const realTwice = throwMessage(() => realInitialize());
      await realEsbuild.stop();
      // main.js stopService resets initializeWasCalled — legal again.
      await realInitialize(null);

      await withHost({ initialize: () => Promise.resolve() }, async (shim) => {
        await shim.initialize({ worker: false });
        expect(throwMessage(() => shim.initialize())).toBe(realTwice);
        await shim.stop();
        await shim.initialize(null);
      });
    } finally {
      await realEsbuild.stop();
    }
  });

  it('import + require serve ONE module instance — cross-entry double-initialize throws exactly like real esbuild (real Node loader)', async () => {
    // Real esbuild IS a single CJS singleton across both entry styles: the
    // ESM default equals require('esbuild'), so initialize() has ONE gate.
    const real = probeEntryStyles(linkRealPackage);
    expect(real).toEqual({
      defaultIsCjs: true,
      namedInitializeIsCjs: true,
      secondInitAcrossPaths: { err: 'Cannot call "initialize" more than once' },
    });
    expect(probeEntryStyles(writeShimPackage)).toEqual(real);
  }, 20000);

  it('stop() kills pre-stop contexts EXACTLY like real esbuild; transform + new contexts survive — BOTH sides', async () => {
    let real: Record<string, Outcome>;
    try {
      real = await postStopLifecycle(realEsbuild as unknown as EsbuildLifecycleApi);
    } finally {
      await realEsbuild.stop();
    }
    // Pin the real channel shape so a silent oracle regression is loud:
    // first dead request = write-failure flush, later = settled early-return.
    expect(real.rebuildFirst).toEqual({
      err: 'The service was stopped: Cannot call write after a stream was destroyed',
    });
    expect(real.watchNext).toEqual({
      err: 'The service is no longer running: Cannot call write after a stream was destroyed',
    });
    expect(real.cancelOnDead).toEqual({ ok: true });
    expect(real.transformAfterStop).toEqual({ ok: true });

    const makeHostCtx = (): ShimContext => ({
      rebuild: () => Promise.resolve({}),
      watch: () => Promise.resolve(undefined),
      serve: () => Promise.resolve({}),
      cancel: () => Promise.resolve(undefined),
      dispose: () => Promise.resolve(undefined),
    });
    await withHost(
      {
        context: () => Promise.resolve(makeHostCtx()),
        transform: () => Promise.resolve({ code: 'let x = 1;\n' }),
      },
      async (shim) => {
        expect(await postStopLifecycle(shim)).toEqual(real);
      },
    );
  }, 30000);
});
