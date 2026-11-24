// Can a guest already allocate wasm memory outside its memoryLimit? runCode, 64 MiB limit, 128 / 512 MiB
// WebAssembly.Memory filled. usage: node --import tsx guest-wasm.mjs REPO
import { pathToFileURL } from 'node:url';
const { runCode } = await import(
  pathToFileURL(`${process.argv[2]}/packages/isolate-host/src/index.ts`).href
);
const code = (pages) => `
const m = new WebAssembly.Memory({ initial: 1, maximum: 65536 });
m.grow(${pages - 1});
new Uint8Array(m.buffer).fill(1);
const mod = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
console.log(JSON.stringify({ memoryBytes: m.buffer.byteLength, moduleCompiled: mod instanceof WebAssembly.Module }));`;
for (const pages of [2048, 8192]) {
  for (let run = 0; run < 3; run++) {
    const r = await runCode(code(pages), { timeoutMs: 20000, memoryLimitMb: 64 });
    console.log(JSON.stringify({ memoryLimitMb: 64, wasmMiB: pages / 16, run, ...r }));
  }
}
process.exit(0);
