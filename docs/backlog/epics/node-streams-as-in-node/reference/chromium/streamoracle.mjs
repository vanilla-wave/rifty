// Node oracle for streamplan.mjs: project dir = a fresh temp dir; rows appended to OUT.
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan } from './streamplan.mjs';
const out = process.argv[2];
const proj = realpathSync(mkdtempSync(join(tmpdir(), 'nsg-proj-')));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'nsg-tmp-')));
copyFileSync('/tmp/nsg-chromium/streamprobe.cjs', join(proj, 'streamprobe.cjs'));
for (const step of plan) {
  const argv = step.argv.map((a) => a.replace('@TMP@', tmp));
  const r = spawnSync(process.execPath, ['streamprobe.cjs', ...argv], {
    cwd: proj,
    encoding: 'utf8',
    timeout: 900_000,
  });
  const json = /\{"mode".*\}/.exec(r.stdout)?.[0];
  const g = json ? JSON.parse(json) : null;
  const row = {
    route: 'node',
    host: `node ${process.version}`,
    case: step.case,
    mib: step.mib,
    run: step.run,
    ms: g?.ms ?? null,
    ticks: g?.ticks ?? null,
    sha256: g?.sha256 ?? null,
    bytes: g?.bytes ?? g?.size ?? null,
    exit: r.status ?? `signal ${r.signal}`,
    ...(g ? {} : { stderr: r.stderr.slice(0, 300) }),
  };
  appendFileSync(out, `${JSON.stringify(row)}\n`);
}
rmSync(proj, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });
