// One parity case on rifty's modules in this Node, as the parity runner wires it (setup files at `/`,
// entry at /work/main.js, sync mirror, process cwd = case cwd). ROUTE_B=1: `stream`, `stream/promises`
// and fs's stream classes are Node's verbatim sources (verbatim.cjs). Case JSON on argv.
// usage: [ROUTE_B=1 NODE_SRC=…] node --expose-internals --import tsx parity-child.mts REPO CASE.json
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, caseFile] = process.argv.slice(2);
const c = JSON.parse(readFileSync(caseFile, 'utf8'));
const load = (p: string) => import(pathToFileURL(join(repo, p)).href);
const { MemoryFsSync, setSyncMirror } = await load('packages/vfs/src/internal/index.ts');
const { setProcessCwd } = await load('packages/runtime-js/src/builtins/process.ts');
const { refreshRuntimeJsProcessBuiltin } = await load('packages/runtime-js/src/builtins/index.ts');
const { createModuleLoader, createModuleLoaderWithBuiltinOverrides } = await load(
  'packages/runtime-js/src/module-loader/loader.ts',
);
const code = new MemoryFsSync();
const files: Record<string, string> = { '/work/main.js': c.code };
const fsFiles: Record<string, string> = {};
for (const [rel, content] of Object.entries(c.files ?? {})) {
  files[`/work/${rel}`] = content as string;
  fsFiles[`/${rel}`] = content as string;
}
code.loadFixture(files);
const mirror = new MemoryFsSync();
mirror.loadFixture(fsFiles);
const cwd = c.cwd ?? '/';
if (cwd !== '/') mirror.mkdirSync(cwd, { recursive: true });
setSyncMirror(mirror);
setProcessCwd(cwd);
refreshRuntimeJsProcessBuiltin();
let loader = createModuleLoader(code, { cwd: '/work' });
globalThis.Buffer = loader.require('buffer', '/work/main.js').Buffer;
if (process.env.ROUTE_B === '1') {
  const nodeRequire = createRequire(import.meta.url);
  const { loadVerbatim } = nodeRequire('./verbatim.cjs');
  const base = loader;
  const riftyRequire = (id: string) => base.require(id, '/work/main.js');
  const v = loadVerbatim({
    lib: join(process.env.NODE_SRC ?? '', 'lib'),
    riftyRequire,
    nodeRequire,
    process,
  });
  const fsB = Object.create(riftyRequire('fs')) as Record<string, unknown>;
  Object.assign(fsB, {
    ReadStream: v.fsStreams.ReadStream,
    WriteStream: v.fsStreams.WriteStream,
    createReadStream: (p: unknown, o: unknown) => new v.fsStreams.ReadStream(p, o),
    createWriteStream: (p: unknown, o: unknown) => new v.fsStreams.WriteStream(p, o),
  });
  const over = new Map<string, Record<string, unknown>>();
  for (const [k, m] of [
    ['stream', v.stream],
    ['stream/promises', v.promises],
    ['fs', fsB],
  ] as const) {
    over.set(k, m);
    over.set(`node:${k}`, m);
  }
  loader = createModuleLoaderWithBuiltinOverrides(code, { cwd: '/work' }, over);
}
loader.require('./main.js', '/work/[main].js');
