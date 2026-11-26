// One line per surface; run under node and in the sandbox, diff the lines.
const line = (name, f) => {
  let r;
  try {
    r = f();
  } catch (e) {
    r = `THROWS ${e?.name}: ${String(e?.message).slice(0, 120)}`;
  }
  return Promise.resolve(r).then(
    (v) => console.log(`${name}: ${v}`),
    (e) => console.log(`${name}: REJECTS ${e?.name}: ${String(e?.message).slice(0, 120)}`),
  );
};
(async () => {
  for (const g of [
    'URL',
    'URLSearchParams',
    'structuredClone',
    'ReadableStream',
    'WritableStream',
    'TransformStream',
    'DecompressionStream',
    'CompressionStream',
    'AbortController',
    'AbortSignal',
    'EventTarget',
    'Event',
    'MessageChannel',
    'Blob',
    'Response',
    'fetch',
    'DOMException',
    'DOMMatrix',
    'Path2D',
    'ImageData',
    'OffscreenCanvas',
    'navigator',
    'WebAssembly',
    'FinalizationRegistry',
    'WeakRef',
    'TextDecoder',
    'TextEncoder',
    'Intl',
    'atob',
    'btoa',
    'queueMicrotask',
    'setImmediate',
    'performance',
    'crypto',
    'Worker',
    'document',
    'window',
    'self',
    'SharedArrayBuffer',
  ])
    await line(`typeof ${g}`, () => typeof globalThis[g]);
  await line('new URL', () => new URL('file:///a/b.pdf').href);
  await line('URL.parse', () => typeof URL.parse);
  await line('URL.createObjectURL', () => typeof URL.createObjectURL);
  await line('new URLSearchParams', () => new URLSearchParams('a=1').get('a'));
  await line('structuredClone', () =>
    JSON.stringify(structuredClone({ a: new Uint8Array([1, 2]) })),
  );
  await line(
    'new ReadableStream',
    () =>
      typeof new ReadableStream({
        start(c) {
          c.close();
        },
      }).getReader,
  );
  await line('new DecompressionStream', () => typeof new DecompressionStream('deflate').writable);
  await line('new AbortController', () => new AbortController().signal.aborted);
  await line('AbortSignal.any', () => typeof AbortSignal.any);
  await line('new EventTarget', () => typeof new EventTarget().addEventListener);
  await line('new MessageChannel', () => typeof new MessageChannel().port1.postMessage);
  await line('DOMException', () => new DOMException('m', 'AbortError').name);
  await line('Promise.withResolvers', () => typeof Promise.withResolvers);
  await line('Promise.try', () => typeof Promise.try);
  await line('Array.fromAsync', () => typeof Array.fromAsync);
  await line('Uint8Array.fromBase64', () => typeof Uint8Array.fromBase64);
  await line('Uint8Array#toHex', () => typeof Uint8Array.prototype.toHex);
  await line('Math.sumPrecise', () => typeof Math.sumPrecise);
  await line('Object.groupBy', () => typeof Object.groupBy);
  await line('process.getBuiltinModule', () => typeof process.getBuiltinModule);
  await line(
    'process.getBuiltinModule(fs)',
    () => typeof process.getBuiltinModule('fs').readFileSync,
  );
  await line(
    'process.getBuiltinModule(module).createRequire',
    () => typeof process.getBuiltinModule('module').createRequire,
  );
  await line(
    'createRequire(path)',
    () => typeof require('node:module').createRequire(__filename)('fs').readFileSync,
  );
  await line(
    'createRequire(file URL string)',
    () => typeof require('node:module').createRequire(`file://${__filename}`)('fs').readFileSync,
  );
  await line('url.pathToFileURL', () =>
    String(require('node:url').pathToFileURL(__filename)).replace(/.*\//, ''),
  );
  await line('url.fileURLToPath', () => require('node:url').fileURLToPath('file:///a/b'));
  await line('TextDecoder utf-8 fatal', () =>
    new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xd0, 0x9f])),
  );
  await line('TextDecoder utf-16be fatal', () =>
    new TextDecoder('utf-16be', { fatal: true }).decode(new Uint8Array([0x04, 0x1f])),
  );
  await line('TextDecoder latin1', () => new TextDecoder('latin1').decode(new Uint8Array([0xe9])));
  await line('Intl.Segmenter', () => typeof Intl.Segmenter);
  await line('String#normalize NFKC', () => 'ﬁ'.normalize('NFKC'));
  await line('WebAssembly.instantiate (8-byte module)', async () =>
    Object.keys(await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).join(
      ',',
    ),
  );
  await line(
    'new WebAssembly.Module',
    () =>
      new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])) instanceof
      WebAssembly.Module,
  );
  await line('new FinalizationRegistry', () => typeof new FinalizationRegistry(() => {}).register);
  await line('zlib.inflateSync', () =>
    require('node:zlib').inflateSync(Buffer.from('eJxLtDKwqq4FAAZPAf8=', 'base64')).toString(),
  );
  await line('fs.readFileSync pooled offset', () => {
    const fs = require('node:fs');
    fs.writeFileSync('/tmp-probe-a', 'x'.repeat(100));
    const a = fs.readFileSync('/tmp-probe-a');
    const b = fs.readFileSync('/tmp-probe-a');
    return `${a.byteOffset},${b.byteOffset} buffer ${a.buffer.byteLength}`;
  });
  await line('assign globalThis.ReadableStream', () => {
    const o = globalThis.ReadableStream;
    globalThis.ReadableStream = function X() {};
    const ok = globalThis.ReadableStream.name === 'X';
    globalThis.ReadableStream = o;
    return ok;
  });
  await line('delete globalThis.URLSearchParams', () => {
    const d = Object.getOwnPropertyDescriptor(globalThis, 'URLSearchParams');
    // biome-ignore lint/performance/noDelete: measures delete of the global itself
    const ok = delete globalThis.URLSearchParams;
    const t = typeof URLSearchParams;
    if (d) Object.defineProperty(globalThis, 'URLSearchParams', d);
    return `${ok} then typeof ${t}; descriptor ${d ? Object.keys(d).join('/') : 'none'} writable=${d?.writable} configurable=${d?.configurable}`;
  });
  await line('import(cjs file)', async () =>
    Object.keys(await import('../gen/_out.cjs')).join(','),
  );
  await line('import(node:fs)', async () => typeof (await import('node:fs')).readFileSync);
})();
