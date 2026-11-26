// Which async WebAssembly entry points exist, and does a pending Blob read hold the run.
console.log(
  ['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming', 'validate']
    .map((n) => `${n}:${typeof WebAssembly[n]}`)
    .join(' '),
);
new Blob([new Uint8Array(1 << 22)])
  .arrayBuffer()
  .then((b) => console.log(`Blob.arrayBuffer settled ${b.byteLength}`));
