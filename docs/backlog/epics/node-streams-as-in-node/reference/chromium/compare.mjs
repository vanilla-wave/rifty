// run.mjs's rule over Node (oracle, file stdout) vs Chromium host results.
// `name => value` lines keyed by name, others by line index; same = line equal AND exit status equal.
// usage: node compare.mjs OUT_DIR COMMIT host1=file1.json [host2=file2.json ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [outDir, commit, ...hostArgs] = process.argv.slice(2);
const oracle = JSON.parse(readFileSync(join(outDir, 'node-oracle.json'), 'utf8'));
const hosts = hostArgs.map((a) => {
  const [name, file] = a.split('=');
  return { name, data: JSON.parse(readFileSync(file, 'utf8')) };
});
const user = homedir().split('/').pop();
const mask = (s) => s.split(homedir()).join('<home>').split(user).join('<user>');
const firstLine = (s) => {
  const ls = s.split('\n').filter((l) => l.trim() && !l.startsWith('    at '));
  return ls.find((l) => /^[A-Za-z]*(Error|Exception)\b/.test(l)) ?? ls[0] ?? '';
};
const rowsOf = (stdout) => {
  const m = new Map();
  stdout
    .split('\n')
    .filter(Boolean)
    .forEach((l, i) => {
      const at = l.indexOf(' => ');
      m.set(at > 0 ? l.slice(0, at) : `line ${i + 1}`, at > 0 ? l.slice(at + 4) : l);
    });
  return m;
};
const COLS = ['node', ...hosts.map((h) => h.name)];
const header = [
  `node ${oracle.node}; rifty ${commit}; ${hosts
    .map(
      (h) => `${h.name}: Chromium ${h.data.chromium} (rifty process.version ${h.data.riftyNode})`,
    )
    .join('; ')}`,
  `columns: ${COLS.join(' | ')}`,
];
const summary = [
  ...header,
  'program | Node rows | same as Node per host (+ lines only that host printed)',
];
const firstDiffs = [];
for (const name of Object.keys(oracle.programs)) {
  const n = oracle.programs[name].file;
  const outs = [{ stdout: n.stdout, stderr: n.stderr, status: n.status }];
  for (const h of hosts) {
    const r = h.data.results[name];
    if (!r) outs.push({ stdout: '', stderr: '(not run)', status: 'not run' });
    else outs.push({ stdout: r.stdout, stderr: r.stderr ?? '', status: r.status });
  }
  const rows = outs.map((o) => rowsOf(o.stdout));
  const keys = [...new Set(rows.flatMap((m) => [...m.keys()]))];
  const lines = [`# ${name}.cjs`, ...header, ''];
  lines.push(`exit: ${COLS.map((c, i) => `${c} ${outs[i].status}`).join(' | ')}`);
  COLS.forEach((c, i) => {
    if (outs[i].stderr.trim())
      lines.push(`stderr ${c}: ${mask(firstLine(outs[i].stderr)).slice(0, 200)}`);
  });
  lines.push('');
  const same = hosts.map(() => 0);
  const extra = hosts.map(() => 0);
  const first = hosts.map(() => null);
  for (const k of keys) {
    const vals = rows.map((m) => (m.has(k) ? m.get(k) : '(no line)'));
    lines.push(`## ${k}`);
    vals.forEach((v, i) => {
      const ok = i > 0 && rows[0].has(k) && v === vals[0] && outs[i].status === outs[0].status;
      if (ok) same[i - 1]++;
      if (i > 0 && !rows[0].has(k) && rows[i].has(k)) extra[i - 1]++;
      if (i > 0 && !ok && first[i - 1] === null)
        first[i - 1] = { k, node: vals[0], host: v, status: [outs[0].status, outs[i].status] };
      lines.push(`${COLS[i]}${i === 0 ? '' : ok ? ' (same)' : ' (DIFF)'}: ${mask(v)}`);
    });
  }
  writeFileSync(join(outDir, `${name}.txt`), `${lines.join('\n')}\n`);
  summary.push(
    `${name}.cjs | ${rows[0].size} | ${hosts
      .map((h, i) => `${h.name} ${same[i]}/${rows[0].size}${extra[i] ? ` +${extra[i]} extra` : ''}`)
      .join(' | ')}`,
  );
  hosts.forEach((h, i) => {
    const f = first[i];
    firstDiffs.push(
      f === null
        ? `${name} [${h.name}]: none`
        : `${name} [${h.name}]: "${f.k}" node="${mask(f.node)}" chromium="${mask(f.host)}" exit node=${f.status[0]} chromium=${f.status[1]}`,
    );
  });
}
writeFileSync(join(outDir, 'summary.txt'), `${summary.join('\n')}\n`);
writeFileSync(join(outDir, 'first-diffs.txt'), `${firstDiffs.join('\n')}\n`);
console.log(summary.join('\n'));
