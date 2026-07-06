import type { ParityCase } from '../../src/types.ts';

/**
 * Stream string-options overload + encoding semantics, golden from real Node:
 * `createReadStream(path, 'utf8')` emits STRINGS; `createWriteStream(path,
 * 'base64')` decodes string writes as base64 (per-write encoding overrides the
 * stream default; `end(chunk)` uses the default too); a non-string/object
 * options arg is ERR_INVALID_ARG_TYPE and an invalid encoding value is
 * ERR_INVALID_ARG_VALUE — both SYNCHRONOUS. rifty used to silently ignore the
 * string overload (Buffers where Node emits strings, utf8 writes where Node
 * decodes base64) — the silent-divergence kind of gap (review 2026-07-06).
 */
const c: ParityCase = {
  setup: { files: { 'in.txt': 'héllo' } },
  code: `
    const fs = require('node:fs');
    const probeSync = (label, fn) => {
      try {
        fn();
        console.log(label + ': no-throw');
      } catch (err) {
        console.log(label + ':', err.code ?? err.name);
      }
    };
    probeSync('read-numeric-options', () => fs.createReadStream('in.txt', 42));
    probeSync('read-bogus-encoding', () => fs.createReadStream('in.txt', 'bogus'));
    probeSync('write-numeric-options', () => fs.createWriteStream('w0.bin', 42));
    probeSync('write-bogus-encoding', () => fs.createWriteStream('w0.bin', 'bogus'));

    const main = async () => {
      const chunks = [];
      const rs = fs.createReadStream('in.txt', 'utf8');
      rs.on('data', (c) => chunks.push(typeof c + ':' + c));
      await new Promise((resolve) => rs.on('end', resolve));
      console.log('read-utf8-overload:', JSON.stringify(chunks));

      const ws1 = fs.createWriteStream('w1.bin', 'base64');
      ws1.write('aGVsbG8='); // 'hello'
      await new Promise((resolve) => ws1.end(resolve));
      console.log('write-base64-default:', fs.readFileSync('w1.bin', 'utf8'));

      const ws2 = fs.createWriteStream('w2.bin', { encoding: 'base64' });
      ws2.write('68656c6c6f', 'hex'); // per-write override
      await new Promise((resolve) => ws2.end(resolve));
      console.log('write-hex-override:', fs.readFileSync('w2.bin', 'utf8'));

      const ws3 = fs.createWriteStream('w3.bin', 'base64');
      await new Promise((resolve) => ws3.end('d29ybGQ=', resolve)); // 'world'
      console.log('end-chunk-default-encoding:', fs.readFileSync('w3.bin', 'utf8'));
    };
    main();
  `,
};

export default c;
