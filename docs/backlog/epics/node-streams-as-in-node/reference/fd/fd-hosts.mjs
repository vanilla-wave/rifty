// fd-scale.cjs on real Node, rifty in-process (memory VFS) and the isolate sandbox (memory VFS).
// usage: node --import tsx fd-hosts.mjs REPO   (stdout: one block per host)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [repo] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'fd-scale.cjs'));
const { inSandbox } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/tests/package-closure.ts')).href
);
const dir = mkdtempSync(join(tmpdir(), 'nsg-fd-'));
writeFileSync(join(dir, 'fd-scale.cjs'), src);
const tsx = pathToFileURL(join(repo, 'node_modules/tsx/dist/loader.mjs')).href;
console.log(`node ${process.version}`);
console.log('## node');
console.log(
  spawnSync(process.execPath, ['fd-scale.cjs'], { cwd: dir, encoding: 'utf8' }).stdout.trim(),
);
console.log('## rifty in-process (memory VFS)');
console.log(
  spawnSync(
    process.execPath,
    ['--import', tsx, join(here, '../inproc.mts'), repo, dir, 'fd-scale.cjs'],
    { encoding: 'utf8' },
  ).stdout.trim(),
);
console.log('## rifty isolate sandbox (memory VFS)');
const r = await inSandbox(new Map([['fd-scale.cjs', src]]), 'fd-scale.cjs', 'none');
console.log(r.stdout.trim() || `exit ${r.exitCode} ${r.stderr.slice(0, 200)}`);
rmSync(dir, { recursive: true, force: true });
process.exit(0);
