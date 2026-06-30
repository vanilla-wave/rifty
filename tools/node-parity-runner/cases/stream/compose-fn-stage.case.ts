import type { ParityCase } from '../../src/types.ts';

/**
 * `stream.compose` with a lone async-generator-function stage constructs an
 * `instanceof Duplex` and drains its yields. Asserted head-to-head vs Node.
 * (A mixed Transform+async-gen chain is a sibling case so each keeps one short
 * async tail for the in-process harness drain.)
 */
const c: ParityCase = {
  code: `
    const { compose, Duplex } = require('node:stream');
    (async () => {
      const b = compose(async function* (src) { for await (const c of src) yield String(c).toUpperCase(); });
      const out = [];
      b.on('data', (c) => out.push(c));
      b.end('ab');
      await new Promise((r) => setTimeout(r, 15));
      console.log('asyncgen-instance:' + (b instanceof Duplex));
      console.log('asyncgen-drain:' + JSON.stringify(out));
    })();
  `,
};

export default c;
