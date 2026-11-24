// node diag.cjs: one line per surface the four libraries' paths touch (from trace.cjs under real
// Node, plus the modules exceljs's main entry loads past its first gap): `name: ok` or the error.
// The probe diffs these lines between real node and the sandbox — the whole list, not the first stop.
const lines = [];
const check = (name, fn) => {
  try {
    const v = fn();
    lines.push(`${name}: ${v === undefined ? 'ok' : v}`);
  } catch (e) {
    lines.push(`${name}: ${e?.name}: ${String(e?.message).split('\n')[0]}`);
  }
};
const BUILTINS = [
  'assert',
  'buffer',
  'constants',
  'crypto',
  'events',
  'fs',
  'os',
  'path',
  'stream',
  'string_decoder',
  'util',
  'zlib',
  'https',
  'http',
  'url',
  'worker_threads',
  'child_process',
  'timers',
  'process',
];
for (const m of BUILTINS) check(`require('${m}')`, () => void require(m));
// Package modules on the libraries' paths (exceljs's main entry loads all of these).
const PACKAGES = [
  'jszip',
  'pako',
  'fflate',
  'nanoid',
  'readable-stream',
  'setimmediate',
  'image-size',
  'saxes',
  'dayjs',
  'uuid',
  'tmp',
  'graceful-fs',
  'fstream',
  'glob',
  'readdir-glob',
  'lazystream',
  'bluebird',
  '@fast-csv/format',
  '@fast-csv/parse',
  'unzipper',
  'archiver',
  'exceljs/lib/doc/workbook',
  'exceljs',
];
for (const m of PACKAGES) check(`require('${m}')`, () => void require(m));
// Web globals the libraries read (trace.cjs), as they use them.
check('new Blob([])', () =>
  String(new Blob([new ArrayBuffer(0)], { type: 'application/zip' }).size),
);
check('navigator.userAgent', () => typeof navigator.userAgent);
check('typeof CustomEvent', () => typeof CustomEvent);
check("new CustomEvent('x')", () => void new CustomEvent('x'));
check("new TextDecoder('utf-8')", () => void new TextDecoder('utf-8'));
check('typeof setImmediate', () => typeof setImmediate);
check('typeof queueMicrotask', () => typeof queueMicrotask);
check('typeof WeakRef', () => typeof WeakRef);
check('typeof FinalizationRegistry', () => typeof FinalizationRegistry);
check('process.release.name', () => process.release?.name);
check('typeof process.versions.node', () => typeof process.versions.node);
for (const l of lines) console.log(l);
// import() of builtins: pptxgenjs's path (pptxgen.cjs.js:4844-4845, :7207).
const imports = ['node:fs', 'node:https'].map((m) =>
  import(m).then(
    () => `import('${m}'): ok`,
    (e) => `import('${m}'): ${e?.name}: ${String(e?.message).split('\n')[0]}`,
  ),
);
Promise.all(imports).then((r) => {
  for (const l of r) console.log(l);
});
