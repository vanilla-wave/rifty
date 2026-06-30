import type { ParityCase } from '../../src/types.ts';

/**
 * `{ signal }` abort mid-iteration rejects the helper with an `AbortError`
 * (`code:'ABORT_ERR'`). A slow async-generator source feeds `map`; the signal
 * aborts before it drains. Asserted head-to-head against real Node.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      const ac = new AbortController();
      async function* slow() { for (let i = 0; i < 100; i++) { await delay(5); yield i; } }
      const p = Readable.from(slow()).map(async (x) => x, { signal: ac.signal }).toArray().then(
        () => 'no-reject',
        (e) => e.name + ':' + e.code,
      );
      setTimeout(() => ac.abort(), 12);
      console.log('abort:' + (await p));
    })();
  `,
};

export default c;
