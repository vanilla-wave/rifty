// Async WebAssembly entry points vs the end of a run. argv[2]: mode; argv[3]: wasm path or 'tiny'.
// Written for both `node file` and runCode (no fs needed for 'tiny'; runCode passes bytes inline).
const TINY = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 6, 1,
  4, 0, 65, 42, 11,
];
const mode = globalThis.__mode ?? process.argv[2];
const src = globalThis.__src ?? process.argv[3];
const bytes =
  src === 'tiny'
    ? new Uint8Array(TINY)
    : (globalThis.__bytes ?? require('node:fs').readFileSync(src));
console.log(`bytes ${bytes.length}`);
const tag = (v) => v?.constructor?.name || typeof v;
const ok = (label) => (v) =>
  console.log(
    `${label}: settled ${v?.instance ? `{module: ${tag(v.module)}, instance: ${tag(v.instance)}}` : tag(v)}`,
  );
const bad = (label) => (e) => console.log(`${label}: rejected ${e?.name}`);
process.on('exit', (c) => console.log(`exit event code ${c}`));
if (mode === 'compile') WebAssembly.compile(bytes).then(ok('compile'), bad('compile'));
if (mode === 'instantiate-bytes')
  WebAssembly.instantiate(bytes, {}).then(ok('instantiate(bytes)'), bad('instantiate(bytes)'));
if (mode === 'instantiate-module')
  WebAssembly.instantiate(new WebAssembly.Module(bytes), {}).then(
    ok('instantiate(Module)'),
    bad('instantiate(Module)'),
  );
if (mode === 'streaming') {
  console.log(
    `typeof compileStreaming ${typeof WebAssembly.compileStreaming}, typeof instantiateStreaming ${typeof WebAssembly.instantiateStreaming}, typeof Response ${typeof Response}`,
  );
  if (typeof WebAssembly.instantiateStreaming === 'function' && typeof Response === 'function')
    WebAssembly.instantiateStreaming(
      new Response(bytes, { headers: { 'content-type': 'application/wasm' } }),
      {},
    ).then(ok('instantiateStreaming'), bad('instantiateStreaming'));
}
// Nobody subscribes: invalid bytes → Node reports the unhandled CompileError and exits 1.
if (mode === 'unsubscribed-invalid') WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 9, 9]));
// Large module cut by 1000 bytes, nobody subscribes (when its compile fails is not timed).
if (mode === 'unsubscribed-invalid-large')
  WebAssembly.compile(bytes.subarray(0, bytes.length - 1000));
if (mode === 'compile-await')
  (async () => {
    const m = await WebAssembly.compile(bytes);
    console.log(`await compile: ${tag(m)}`);
  })();
