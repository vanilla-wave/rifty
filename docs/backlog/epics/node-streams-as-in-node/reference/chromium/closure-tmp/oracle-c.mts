// Real-Node oracle, zlib-carrier layout: closure (closure-files.ts closureFiles) + <name>.cjs in one dir,
// cwd = that dir, `node <name>.cjs` with piped stdio (as the Workbench runner's child).
// usage: node --import tsx oracle-c.mts REPO PROGRAMS_DIR OUT_DIR
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, programsDir, outDir] = process.argv.slice(2);
const { closureFiles } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/tests/closure-files.ts')).href
);
const closure: Map<string, Uint8Array> = closureFiles(
  'exceljs',
  realpathSync(join(repo, 'packages/isolate-host/node_modules/exceljs')),
);
let bytes = 0;
for (const b of closure.values()) bytes += b.byteLength;
const base = join(realpathSync(tmpdir()), 'nsg-oracle-c');
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
const result: Record<string, unknown> = {};
for (const file of readdirSync(programsDir)
  .filter((n) => n.endsWith('.cjs'))
  .sort()) {
  const name = file.replace(/\.cjs$/, '');
  const dir = join(base, `nsg-${name}`);
  for (const [rel, data] of [...closure, [file, readFileSync(join(programsDir, file))] as const]) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), data);
  }
  const r = spawnSync(process.execPath, [file], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const mask = (s: string) =>
    s.split(dir).join('<dir>').split(base).join('<root>').split(homedir()).join('<home>');
  result[name] = {
    stdout: mask(r.stdout ?? ''),
    stderr: mask(r.stderr ?? ''),
    status: r.status ?? `signal ${r.signal}`,
  };
  console.log(name, r.status);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'node-oracle.json'),
  JSON.stringify(
    {
      node: process.version,
      closure: { files: closure.size, bytes },
      programs: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { file: v }])),
    },
    null,
    1,
  ),
);
console.log('closure', closure.size, 'files', bytes, 'bytes');
