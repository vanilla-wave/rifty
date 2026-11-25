// rifty's browser-host modules in this Node process: `dir` loaded into the memory VFS (sync + async
// surface, as the hosts install it) at /workspace, `entry` required through rifty's module loader.
// Node's platform objects (timers, console, process) — not Chromium. usage: [SYNC_ONLY=1] node --import tsx inproc.mts REPO DIR ENTRY
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, dir, entry] = process.argv.slice(2);
const load = (p: string) => import(pathToFileURL(join(repo, p)).href);
const { syncMirror } = await load('packages/vfs/src/index.ts');
const { createModuleLoader } = await load('packages/runtime-js/src/module-loader/index.ts');
// SYNC_ONLY=1: sync mirror only, no async Vfs (the parity runner's and PR #437's guest wiring).
const { MemoryFsSync, installMemoryFs, setSyncMirror } = await load(
  'packages/vfs/src/internal/index.ts',
);
if (process.env.SYNC_ONLY === '1') setSyncMirror(new MemoryFsSync());
else installMemoryFs();
const vfs = syncMirror();
const walk = (abs: string, rel: string): void => {
  for (const name of readdirSync(abs)) {
    const a = join(abs, name);
    const r = `${rel}/${name}`;
    if (statSync(a).isDirectory()) {
      vfs.mkdirSync(r, { recursive: true });
      walk(a, r);
    } else vfs.writeFileSync(r, readFileSync(a));
  }
};
vfs.mkdirSync('/workspace', { recursive: true });
walk(dir, '/workspace');
let loader = createModuleLoader(vfs, { cwd: '/workspace' });
// ROUTE_B=1 (node --expose-internals): `stream`, `stream/promises` and fs's stream classes are Node's
// verbatim sources (route-b/verbatim.cjs) over rifty's events/buffer/string_decoder/fs.
if (process.env.ROUTE_B === '1') {
  const { createRequire } = await import('node:module');
  const nodeRequire = createRequire(import.meta.url);
  const { loadVerbatim } = nodeRequire('./route-b/verbatim.cjs');
  const base = loader;
  const riftyRequire = (id: string) => base.require(id, '/workspace/[main].cjs');
  const lib = join(process.env.NODE_SRC ?? '', 'lib');
  const v = loadVerbatim({ lib, riftyRequire, nodeRequire, process });
  const fsRifty = riftyRequire('fs') as Record<string, unknown>;
  const fsB = Object.create(fsRifty) as Record<string, unknown>;
  Object.assign(fsB, {
    ReadStream: v.fsStreams.ReadStream,
    WriteStream: v.fsStreams.WriteStream,
    createReadStream: (p: unknown, o: unknown) => new v.fsStreams.ReadStream(p, o),
    createWriteStream: (p: unknown, o: unknown) => new v.fsStreams.WriteStream(p, o),
  });
  const { createModuleLoaderWithBuiltinOverrides } = await load(
    'packages/runtime-js/src/module-loader/loader.ts',
  );
  const over = new Map<string, Record<string, unknown>>();
  for (const [k, m] of [
    ['stream', v.stream],
    ['stream/promises', v.promises],
    ['fs', fsB],
  ] as const) {
    over.set(k, m);
    over.set(`node:${k}`, m);
  }
  loader = createModuleLoaderWithBuiltinOverrides(vfs, { cwd: '/workspace' }, over);
  if (process.env.ROUTE_B_USED)
    process.on('exit', () =>
      process.stderr.write(
        `route-b used ${JSON.stringify({ rifty: [...v.used.rifty], node: [...v.used.node].sort() })}\n`,
      ),
    );
}
// A bare `Buffer` is rifty's, as every host installs it (installBundleLocalBuffer); `process`, timers and
// console stay Node's (trap parity-runner-in-process): the programs print no `process` state.
globalThis.Buffer = loader.require('buffer', '/workspace/[main].cjs').Buffer;
loader.require(`./${entry}`, '/workspace/[main].cjs');
