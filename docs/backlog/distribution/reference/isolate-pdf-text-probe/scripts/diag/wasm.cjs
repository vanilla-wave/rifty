// Async WebAssembly compile of a real (multi-MB) module: does the promise settle before the run ends?
// argv[2]: mode, argv[3]: wasm path
const fs = require('node:fs');
const [mode, file] = process.argv.slice(2);
const bytes = fs.readFileSync(file);
console.log(`wasm bytes ${bytes.length}`);
const _t0 = Date.now();
const done = (label) => (v) =>
  console.log(`${label}: settled (${typeof v}, ${v?.constructor?.name})`);
if (mode === 'sync') {
  const m = new WebAssembly.Module(bytes);
  console.log(`new WebAssembly.Module: ok, ${WebAssembly.Module.imports(m).length} imports`);
}
if (mode === 'compile')
  WebAssembly.compile(bytes).then(done('WebAssembly.compile'), (e) =>
    console.log('compile rejected', e.message),
  );
if (mode === 'compile-keepalive') {
  const iv = setInterval(() => {}, 20);
  WebAssembly.compile(bytes)
    .then(done('WebAssembly.compile + interval'), (e) => console.log('rejected', e.message))
    .finally(() => clearInterval(iv));
}
if (mode === 'compile-await-timer') {
  WebAssembly.compile(bytes).then(done('WebAssembly.compile + 3 s timer'));
  setTimeout(() => console.log('timer fired'), 3000);
}
process.on('exit', (c) => console.log(`exit event code ${c}`));
