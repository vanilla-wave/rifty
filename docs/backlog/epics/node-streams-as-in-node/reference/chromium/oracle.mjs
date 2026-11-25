// Real-Node oracle, same layout as the Chromium run: <root>/node_modules (exceljs closure, c-* only)
// + <root>/<name>/<name>.cjs, cwd <root>/<name>. Two stdout modes: `> ../<name>.stdout` (file, as the
// Workbench run) and a pipe (run.mjs's spawnSync).
// usage: node oracle.mjs PROGRAMS_DIR CLOSURE_JSON OUT_DIR
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const [programsDir, closureJson, outDir] = process.argv.slice(2);
const root = join(realpathSync(tmpdir()), 'nsg-oracle-root');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const closure = JSON.parse(readFileSync(closureJson, 'utf8'));
for (const [rel, b64] of Object.entries(closure)) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), Buffer.from(b64, 'base64'));
}
const mask = (s, dir) =>
  s.split(dir).join('<dir>').split(root).join('<root>').split(homedir()).join('<home>');
mkdirSync(outDir, { recursive: true });
const result = { node: process.version, programs: {} };
for (const file of readdirSync(programsDir)
  .filter((n) => n.endsWith('.cjs'))
  .sort()) {
  const name = file.replace(/\.cjs$/, '');
  const one = {};
  for (const mode of ['file', 'pipe']) {
    const dir = join(root, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    writeFileSync(join(dir, file), readFileSync(join(programsDir, file)));
    const stdoutPath = join(root, `${name}.stdout`);
    rmSync(stdoutPath, { force: true });
    const r =
      mode === 'file'
        ? spawnSync('sh', ['-c', `'${process.execPath}' ${file} > ../${name}.stdout`], {
            cwd: dir,
            encoding: 'utf8',
            timeout: 180_000,
          })
        : spawnSync(process.execPath, [file], { cwd: dir, encoding: 'utf8', timeout: 180_000 });
    const stdout = mode === 'file' ? readFileSync(stdoutPath, 'utf8') : r.stdout;
    one[mode] = {
      stdout: mask(stdout, dir),
      stderr: mask(r.stderr ?? '', dir),
      status: r.status ?? `signal ${r.signal}`,
    };
  }
  result.programs[name] = one;
  console.log(
    name,
    one.file.status,
    one.pipe.status,
    one.file.stdout === one.pipe.stdout ? 'file==pipe' : 'file!=pipe',
  );
}
writeFileSync(join(outDir, 'node-oracle.json'), JSON.stringify(result, null, 1));
