#!/usr/bin/env node
/**
 * Probe G's Node oracle, one sequence per process (review 5, S2: `fs.cpSync` of a directory onto a
 * file aborts Node v24.16.0 — `libc++abi … filesystem_error: create_directory: File exists`,
 * SIGABRT — so the oracle must not share the generator's process). argv[2]: an empty directory; stdin: `{ tpl, t0, ops }`;
 * stdout: `{ nr, nt }` — each call's result and the final tree, the shapes `gen.mjs` compares.
 */
import * as nfs from 'node:fs';
import { join } from 'node:path';

const input = JSON.parse(nfs.readFileSync(0, 'utf8'));
const T0 = input.t0;
const stamp = (ms) => (ms < 1.7e12 ? Math.round(ms) : 'now');
const code = (e) => (typeof e?.code === 'string' ? e.code : `throw:${e?.message}`);

// The parent makes and removes the directory: an abort skips this process's cleanup.
const root = process.argv[2];
nfs.mkdirSync(join(root, 'workspace'));
for (const [p, t] of Object.entries(input.tpl)) {
  nfs.mkdirSync(join(root, p, '..'), { recursive: true });
  nfs.writeFileSync(join(root, p), t);
}
const touch = (abs) => {
  if (nfs.statSync(abs).isDirectory()) for (const n of nfs.readdirSync(abs)) touch(join(abs, n));
  nfs.utimesSync(abs, T0 / 1000, T0 / 1000);
};
touch(join(root, 'node_modules'));
const at = (q) => join(root, q);
const one = ([k, p, a]) => {
  try {
    if (k === 'mkdir') nfs.mkdirSync(at(p), a);
    else if (k === 'write') nfs.writeFileSync(at(p), a);
    else if (k === 'hostwrite') {
      nfs.mkdirSync(join(at(p), '..'), { recursive: true });
      nfs.writeFileSync(at(p), a);
    } else if (k === 'rm') nfs.rmSync(at(p), a);
    else if (k === 'rename') nfs.renameSync(at(p), at(a));
    else if (k === 'cp') nfs.cpSync(at(p), at(a), { recursive: true });
    else if (k === 'copy') nfs.copyFileSync(at(p), at(a));
    else if (k === 'utimes') nfs.utimesSync(at(p), a / 1000, a / 1000);
    else if (k === 'read') return `=${nfs.readFileSync(at(p), 'utf8')}`;
    else if (k === 'readdir')
      return `=${nfs
        .readdirSync(at(p), { withFileTypes: true })
        .map((d) => `${d.name}:${d.isDirectory() ? 'd' : 'f'}`)
        .sort()
        .join(',')}`;
    else if (k === 'stat') {
      const st = nfs.statSync(at(p));
      return `=${JSON.stringify({
        f: st.isFile(),
        d: st.isDirectory(),
        size: st.isDirectory() ? 0 : st.size,
        nlink: st.nlink,
        m: stamp(st.mtimeMs),
        a: stamp(st.atimeMs),
        c: stamp(st.ctimeMs),
        b: stamp(st.birthtimeMs),
      })}`;
    }
    return 'ok';
  } catch (e) {
    return code(e);
  }
};
const nr = input.ops.map(one);
const nt = {};
const walk = (abs, rel) => {
  for (const name of nfs.readdirSync(abs).sort()) {
    const a = join(abs, name);
    const p = `${rel}/${name}`;
    const st = nfs.statSync(a);
    if (st.isDirectory()) {
      nt[p] = `dir ${stamp(st.mtimeMs)}`;
      walk(a, p);
    } else nt[p] = `file ${nfs.readFileSync(a, 'utf8')} ${stamp(st.mtimeMs)}`;
  }
};
walk(root, '');
process.stdout.write(JSON.stringify({ nr, nt }));
