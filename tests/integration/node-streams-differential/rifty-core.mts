// The differential's rifty column: the generated core over rifty's bindings
// (io streams/node/bindings.ts, the product bindings) with rifty's modules in this Node process —
// memory VFS with its async surface as the hosts install it, rifty's module loader, rifty's bare
// `Buffer`. A program's `stream`, `stream/promises` and `fs` (its stream classes) get that core.
// `process`, timers and console stay Node's (trap parity-runner-in-process).
// usage: node --import tsx rifty-core.mts SPEC.json   (SPEC: RiftySpec below)
import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface VfsDirent {
  readonly name: string;
  readonly isDirectory: boolean;
}
interface RiftySpec {
  /** Files by absolute VFS path, base64. */
  readonly files: Readonly<Record<string, string>>;
  /** The entry's absolute VFS path; the loader's cwd is its directory. */
  readonly entry: string;
  /** The process cwd. */
  readonly cwd: string;
  /** At exit, every file under `cwd` but `node_modules`, base64 JSON, to this host path. */
  readonly dump?: string;
  /** The entry's arguments (`process.argv` after the entry). */
  readonly args: readonly string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const spec = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as RiftySpec;
const load = (p: string) => import(pathToFileURL(join(repo, p)).href);
const { syncMirror } = await load('packages/vfs/src/index.ts');
const { installMemoryFs } = await load('packages/vfs/src/internal/index.ts');
const { setProcessCwd } = await load('packages/runtime-js/src/builtins/process.ts');
const { refreshRuntimeJsProcessBuiltin } = await load('packages/runtime-js/src/builtins/index.ts');
const { createModuleLoader, createModuleLoaderWithBuiltinOverrides } = await load(
  'packages/runtime-js/src/module-loader/loader.ts',
);
const { nodeStreamModule } = await load('packages/io/src/streams/node/bindings.ts');
const { fsWithCoreStreams } = createRequire(import.meta.url)('./fs-facade.cjs');

installMemoryFs();
const vfs = syncMirror();
vfs.mkdirSync(spec.cwd, { recursive: true });
for (const [abs, b64] of Object.entries(spec.files)) {
  vfs.mkdirSync(abs.slice(0, abs.lastIndexOf('/')) || '/', { recursive: true });
  vfs.writeFileSync(abs, Buffer.from(b64, 'base64'));
}
setProcessCwd(spec.cwd);
refreshRuntimeJsProcessBuiltin();
const root = spec.entry.slice(0, spec.entry.lastIndexOf('/')) || '/';
const main = `${root}/[main].cjs`;
const base = createModuleLoader(vfs, { cwd: root });
const fsRifty = base.require('fs', main);
const over = new Map<string, unknown>();
for (const [id, m] of [
  ['stream', nodeStreamModule('stream')],
  ['stream/promises', nodeStreamModule('stream/promises')],
  ['fs', fsWithCoreStreams(fsRifty, nodeStreamModule('internal/fs/streams'))],
] as const) {
  over.set(id, m);
  over.set(`node:${id}`, m);
}
const loader = createModuleLoaderWithBuiltinOverrides(vfs, { cwd: root }, over);
// A bare `Buffer` is rifty's, as every host installs it (installBundleLocalBuffer).
globalThis.Buffer = loader.require('buffer', main).Buffer;

// The guest may leave intrinsics replaced (p1); the dump at exit runs on the pristine ones.
const INTRINSICS = [
  Array.prototype,
  Function.prototype,
  Promise.prototype,
  String.prototype,
  Map.prototype,
  Number,
  Object,
  Reflect,
  globalThis,
];
const pristine = INTRINSICS.map((o) => Object.getOwnPropertyDescriptors(o));
const { defineProperty } = Reflect;
const restoreIntrinsics = (): void => {
  for (let i = 0; i < INTRINSICS.length; i++)
    for (const key of Reflect.ownKeys(pristine[i] as object))
      defineProperty(
        INTRINSICS[i] as object,
        key,
        (pristine[i] as PropertyDescriptorMap)[key as string] as PropertyDescriptor,
      );
};
if (spec.dump !== undefined) {
  const dump = spec.dump;
  process.on('exit', () => {
    restoreIntrinsics();
    const out: Record<string, string> = {};
    const walk = (abs: string, rel: string): void => {
      for (const { name, isDirectory } of vfs.readdirSync(abs) as VfsDirent[]) {
        const a = `${abs === '/' ? '' : abs}/${name}`;
        const r = rel ? `${rel}/${name}` : name;
        if (r === 'node_modules') continue;
        if (isDirectory) walk(a, r);
        else out[r] = Buffer.from(vfs.readFileBytesSync(a)).toString('base64');
      }
    };
    walk(spec.cwd, '');
    writeFileSync(dump, JSON.stringify(out));
  });
}
// One `process` for the program and the core: rifty's, installed as the realm global (as a
// kernel Worker's pre-entry hook does), its `console` writing through it. Node's event loop drives
// the lifecycle, so the harness hands Node's uncaught errors, rejections, `beforeExit` and exit to
// rifty's lifecycle (`process-lifecycle-events.ts`) — rifty's listeners, its fatal report, its
// exit code. What stays Node's: the event loop, timers, microtasks.
const nodeProcess = process;
const riftyProcess = loader.require('process', main) as NodeJS.Process & Record<string, unknown>;
riftyProcess.argv.splice(1, riftyProcess.argv.length - 1, spec.entry, ...spec.args);
const life = await load('packages/runtime-js/src/builtins/process-lifecycle-events.ts');
// rifty's stdout/stderr bytes go to this process's fd 1/2 (a Worker's sink is its stdio port).
const { setDefaultProcessOutputSink } = await load(
  'packages/runtime-js/src/builtins/process-stdio-writer.ts',
);
setDefaultProcessOutputSink((fd: 1 | 2, bytes: Uint8Array) => writeSync(fd, bytes));
let finished = false;
const finish = (code: number): void => {
  finished = true;
  nodeProcess.exit(code);
};
const onFatal = (outcome: { kind: string; signal?: { exitCode: number }; error?: unknown }) => {
  if (outcome.kind === 'handled') return;
  if (outcome.kind === 'exited') return finish(outcome.signal?.exitCode ?? 1);
  finish(life.terminateFatal(outcome.error, riftyProcess)?.exitCode ?? 1);
};
nodeProcess.on('uncaughtException', (error) =>
  life.isRiftyProcessExit(error)
    ? finish(error.exitCode)
    : onFatal(life.dispatchUncaughtException(error, 'uncaughtException', riftyProcess)),
);
nodeProcess.on('unhandledRejection', (reason, promise) =>
  life.isRiftyProcessExit(reason)
    ? finish(reason.exitCode)
    : onFatal(life.dispatchUnhandledRejection(reason, promise, riftyProcess)),
);
nodeProcess.on('beforeExit', () => {
  riftyProcess.emit('beforeExit', riftyProcess.exitCode ?? 0);
});
nodeProcess.on('exit', () => {
  if (finished) return;
  try {
    riftyProcess.exit();
  } catch (signal) {
    if (!life.isRiftyProcessExit(signal)) throw signal;
    nodeProcess.exitCode = signal.exitCode;
  }
});
(globalThis as Record<string, unknown>).process = riftyProcess;
(globalThis as Record<string, unknown>).console = loader.require('console', main);
loader.require(spec.entry, main);
