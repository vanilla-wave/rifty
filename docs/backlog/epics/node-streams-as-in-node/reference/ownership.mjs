// Row ownership: every row of every matrix and carrier program, per host, gets the set of units that
// must land before it equals Node, and its owner = the last of them in the implementation order. A
// row with two or more units is a graph edge (owner ← each other). Derived from results/ only, by
// the rules below; nothing is assigned by hand per row.
// usage: node ownership.mjs   (writes results/ownership.txt)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = join(here, 'results');
/** Implementation order (map §Items); the owner of a row is the last of its units in this order. */
const ORDER = [
  '0',
  '2',
  '1',
  '3',
  '4',
  '4b',
  '7',
  'AL',
  '8a',
  '8b',
  '8c',
  '9r',
  '4c',
  '5',
  'P',
  '9w',
  '7g',
];
// AL: runtime-js/stream-core-abort-listeners-host-event-target (the variant choice A–D).
// 7g: isolate guest globals AbortController/AbortSignal (the user's fork, with the Web API goal's question 1).
const last = (units) => [...units].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).at(-1);

/** One results/<program>.txt: row key → { col → { value, same } }. */
function parse(file) {
  const rows = new Map();
  let key = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('## ')) {
      key = line.slice(3);
      rows.set(key, {});
      continue;
    }
    const m = /^([a-z0-9-]+)( \((same|DIFF)\))?: (.*)$/i.exec(line);
    if (key && m) rows.get(key)[m[1]] = { value: m[4], same: m[3] === 'same' || m[1] === 'node' };
  }
  return rows;
}
const eq = (r, col) => r[col]?.same === true;
/** The binding a route-B row still waits for, by the cause its Bp value shows (map §Remainder). */
function bindingOf(v) {
  if (/string_decoder|Not implemented/.test(v)) return '1';
  if (/Unsupported encoding/.test(v)) return '2';
  if (/ticks>0=false/.test(v)) return '4';
  if (/_writev:object/.test(v)) return '5';
  return '?';
}
/** b1 rows are the bindings themselves, by name. */
function b1Unit(key) {
  if (/StringDecoder/.test(key)) return '1';
  if (/Buffer|buf\./.test(key)) return '2';
  if (/addAbortListener/.test(key)) return '3';
  if (/writev|fsync/.test(key)) return '5';
  return '4';
}
const CORE = /^m([1236789]|10)-|^m1-hooks/;
const FS = /^(m4-|m5-|c-|w1-)/;
const out = [];
const add = (host, prog, key, units, today) => {
  const u = new Set(units);
  out.push({
    host,
    prog,
    key,
    units: [...u].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)),
    owner: today ? 'guard' : last(u),
  });
};
for (const f of readdirSync(res)
  .filter((n) => /^(b1|c-|m\d|w1).*\.txt$/.test(n))
  .sort()) {
  const prog = f.replace(/\.txt$/, '');
  for (const [key, r] of parse(join(res, f))) {
    if (!r.node || r.node.value === '(no line)') continue;
    const inprocToday = eq(r, 'rifty-inproc');
    const units = [];
    // string_decoder shares Buffer's normalisation point (unit 2), so its row needs 2 too.
    if (prog.startsWith('b1-')) units.push(...(b1Unit(key) === '1' ? ['2', '1'] : [b1Unit(key)]));
    else {
      // m9/m10 rows that route B misses wait for the abort-listener variant, not a binding.
      if (!eq(r, 'rifty-inproc-Bp'))
        units.push(/^m(9|10)-/.test(prog) ? 'AL' : bindingOf(r['rifty-inproc-Bp']?.value ?? ''));
      const fsRow = FS.test(prog) || / fs\.|fs streams|fs\.ReadStream|fs\.WriteStream/.test(key);
      // The core is needed when today's value differs from route B's; a window column that already
      // shows route B's value does not need the class it lacks.
      const bp = r['rifty-inproc-Bp']?.value;
      if ((CORE.test(prog) || fsRow) && r['rifty-inproc']?.value !== bp) units.push('8c');
      if (fsRow && r['rifty-inproc-Bp8c']) {
        if (r['rifty-inproc-Bp9w']?.value !== bp) units.push('9r');
        if (r['rifty-inproc-Bp9r']?.value !== bp) units.push('9w');
      }
    }
    // A row equal today stays a guard unless route B breaks it; then its units own it (the core keeps
    // it green and stands on the binding that fixes it).
    add('in-process', prog, key, units, inprocToday && eq(r, 'rifty-inproc-Bp'));
    // Isolate rows. KNOWN LIMIT: no row-level isolate run on route B exists (the product build's
    // isolate data is per program, results/route-b-product-programs.txt), so these rules go by name.
    // - Node itself creates an AbortController in pipeline.js:195, duplexify.js:213 and
    //   operators.js:62,252, and the guest has none, so any row that calls pipeline, compose or a
    //   signal-taking operator needs 7 there.
    // - A guest that makes its own AbortController (m9, m10) needs the guest global: 7g, the user's
    //   fork.
    // - An fs row that is equal in-process but not in the isolate hits the isolate ReadableStream wall,
    //   which 9r removes.
    const nodeMakesController =
      /pipeline|async gen|compose|\.map\(|\.reduce\(/.test(key) || prog === 'c-pipeline-asyncgen';
    const guestMakesController = /^m(9|10)-/.test(prog);
    if (guestMakesController) add('isolate', prog, key, [...units, '7g'], false);
    else if (!eq(r, 'rifty-isolate') && (nodeMakesController || (inprocToday && FS.test(prog)))) {
      const iso = new Set(units);
      if (nodeMakesController) iso.add('7');
      if (FS.test(prog)) iso.add('8c').add('9r');
      add('isolate', prog, key, [...iso], false);
    }
  }
}
// Parity cases on route B (results/route-b-parity-*.txt): equal today but not on route B product
// bindings → the binding its error names, and the core that must not land before it.
for (const file of ['route-b-parity-stream.txt', 'route-b-parity-fs-streams.txt']) {
  for (const line of readFileSync(join(res, file), 'utf8').split('\n')) {
    const m = /^(\S+) \| A (same|DIFF)[^|]*\|[^|]*\| Bp (same|DIFF ?(.*))$/.exec(line);
    if (!m) continue;
    const bpSame = m[3] === 'same';
    const units = bpSame ? ['8c'] : [bindingOf(m[4] ?? ''), '8c'];
    add('in-process (parity)', file, m[1], units, m[2] === 'same' && bpSame);
  }
}
// Workbench: fd I/O rows (results/chromium-fd/*.jsonl) and the carrier's c-transform-big time.
for (const [file, unit] of [
  ['chromium-fd/workbench.jsonl', '4b'],
  ['chromium-fd/workbench-write.jsonl', '4c'],
]) {
  const seen = new Set();
  for (const line of readFileSync(join(res, file), 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(line);
    if (!j.mode || /readfilesync|writefilesync|stream/i.test(j.mode)) continue;
    const k = `${j.persistence} ${j.mode} ${j.mib} MiB`;
    if (seen.has(k)) continue;
    seen.add(k);
    add('workbench', file, k, [unit], false);
  }
}
// Workbench stream timings (results/chromium-d/rows.jsonl, route B = main + wiring). Rules: a stream
// case needs 8c and its class (9r read, 9w write); it also needs the fd range unit (4b read, 4c write)
// when route B's 4 → 16 MiB time grows more than ×10 (×4 the bytes; quadratic shows ≥ ×16); and the
// publication unit P when the same write in a 1000-file project takes ≥ ×2 the fresh-project time.
{
  const rows = readFileSync(join(res, 'chromium-d/rows.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const med = (route, c, mib) => {
    const xs = rows
      .filter((r) => r.route === route && r.case === c && r.mib === mib)
      .map((r) => (typeof r.ms === 'number' ? r.ms : Number.POSITIVE_INFINITY))
      .sort((a, b) => a - b);
    return xs[Math.floor(xs.length / 2)];
  };
  for (const [c, cls, range] of [
    ['read', '9r', '4b'],
    ['write', '9w', '4c'],
  ]) {
    const grows = med('B', c, 16) / med('B', c, 4) > 10;
    // Timers starve on route B where Node's tick (fs callbacks in microtasks: unit 4).
    const tk = (route) =>
      rows
        .filter((x) => x.route === route && x.case === c && x.mib === 16)
        .map((x) => x.ticks ?? 0);
    const starves = tk('node').every((t) => t > 0) && tk('B').every((t) => t === 0);
    add(
      'workbench',
      'chromium-d',
      `${c} 16 MiB stream (B ${Math.round(med('B', c, 16))} ms, Node ${med('node', c, 16)} ms)`,
      ['8c', cls, ...(grows ? [range] : []), ...(starves ? ['4'] : [])],
      false,
    );
  }
  const big = med('B', 'write-bigproject-root', 16);
  const fresh = med('B', 'write', 16);
  const bigText = Number.isFinite(big) ? `${Math.round(big)} ms` : 'timeout 900 s';
  add(
    'workbench',
    'chromium-d',
    `write 16 MiB in a 1000-file project (B ${bigText}, fresh ${Math.round(fresh)} ms)`,
    ['8c', '9w', '4c', ...(big >= 2 * fresh ? ['P'] : [])],
    false,
  );
}
const lines = [
  'Row ownership (ownership.mjs over results/): host | program | row | units | owner (last in order; guard = equal today)',
  'Covers: in-process rows (all programs, parity cases), isolate rows by name rules (see ownership.mjs),',
  'Workbench fd and stream-timing rows. Not covered: SDK rows, Workbench carrier and matrix rows (results/chromium*/',
  'hold them as program summaries only).',
  `order: ${ORDER.join(' → ')}`,
  '',
];
for (const o of out)
  lines.push(`${o.host} | ${o.prog} | ${o.key} | ${o.units.join(',') || '-'} | ${o.owner}`);
const per = {};
const edges = {};
for (const o of out) {
  per[o.owner] = (per[o.owner] ?? 0) + 1;
  for (const u of o.units)
    if (u !== o.owner && o.owner !== 'guard')
      edges[`${o.owner} ← ${u}`] = (edges[`${o.owner} ← ${u}`] ?? 0) + 1;
}
// Windows: rows whose outcome in a unit window (after 8c before 9r: -Bp8c; after 9r before 9w: -Bp9r)
// differs from today's: they are declared changes, pinned on the window's outcome.
lines.push('', '## window changes (window | program | row | today | window value)');
for (const f of readdirSync(res)
  .filter((n) => /^(b1|c-|m\d|w1).*\.txt$/.test(n))
  .sort()) {
  for (const [key, r] of parse(join(res, f))) {
    for (const [win, col] of [
      ['8c window', 'rifty-inproc-Bp8c'],
      ['9r window', 'rifty-inproc-Bp9r'],
    ]) {
      const today = r['rifty-inproc']?.value;
      const v = r[col]?.value;
      if (!r.node || r.node.value === '(no line)' || v === undefined || v === today || r[col]?.same)
        continue;
      lines.push(`${win} | ${f.replace(/\.txt$/, '')} | ${key} | ${today} | ${v}`);
    }
  }
}
lines.push('', '## rows per owner');
for (const u of [...ORDER, 'guard', '?', 'undefined']) if (per[u]) lines.push(`${u}: ${per[u]}`);
lines.push('', '## edges (owner ← unit it also needs, rows)');
for (const [e, n] of Object.entries(edges).sort()) lines.push(`${e}: ${n}`);
writeFileSync(join(res, 'ownership.txt'), `${lines.join('\n')}\n`);
console.log(lines.slice(-30).join('\n'));
