import type { ParityCase } from '../../src/types.ts';

/**
 * `stream.compose(...stages)` of two `Transform`s → a `Duplex` that drains
 * write→stage0→stageN→read (`compose(upper, bracket).end('hi')` → `['[HI]']`).
 * Return type is `instanceof Duplex` (Node's internal `Duplexify` NAME is out of
 * scope). Asserted head-to-head vs Node. (Function-stage variants are sibling
 * cases so each keeps one short async tail for the in-process harness drain.)
 */
const c: ParityCase = {
  code: `
    const { compose, Duplex, Transform } = require('node:stream');
    const upper = () => new Transform({ objectMode: true, transform(c, e, cb) { cb(null, String(c).toUpperCase()); } });
    const bracket = () => new Transform({ objectMode: true, transform(c, e, cb) { cb(null, '[' + c + ']'); } });
    (async () => {
      const a = compose(upper(), bracket());
      const out = [];
      a.on('data', (c) => out.push(c));
      a.end('hi');
      await new Promise((r) => setTimeout(r, 15));
      console.log('compose-instance:' + (a instanceof Duplex));
      console.log('compose-drain:' + JSON.stringify(out));
    })();
  `,
};

export default c;
