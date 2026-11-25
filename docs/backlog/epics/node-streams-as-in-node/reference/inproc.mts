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
createModuleLoader(vfs, { cwd: '/workspace' }).require(`./${entry}`, '/workspace/[main].cjs');
