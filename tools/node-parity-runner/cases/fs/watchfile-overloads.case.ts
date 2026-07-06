import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.watchFile`/`fs.watch` argument-handling parity (observable-order axis):
 * option/encoding validation order vs target existence, the uint32 interval
 * rule (NaN/fractional/Infinity/negative → ERR_OUT_OF_RANGE, 0 valid), and
 * `null` handling in each slot — all golden from real Node, not assumed.
 * `encoding:'buffer'` on an EXISTING target is the recorded rifty gap
 * (NotImplementedError, compat ❌) and deliberately NOT probed here: parity
 * cases pin only where rifty claims Node behavior.
 */
const c: ParityCase = {
  setup: { files: { 'watched.txt': 'one' } },
  code: `
    const fs = require('node:fs');
    const probe = (label, fn) => {
      try {
        fn();
        console.log(label + ': ok');
      } catch (err) {
        console.log(label + ':', err.code ?? err.name);
      }
    };

    probe('watchfile-undefined-options', () => {
      fs.watchFile('watched.txt', undefined, () => {});
      fs.unwatchFile('watched.txt');
    });
    probe('watchfile-null-options', () => {
      fs.watchFile('watched.txt', null, () => {});
      fs.unwatchFile('watched.txt');
    });
    probe('watchfile-invalid-interval-string', () => {
      fs.watchFile('watched.txt', { interval: '1' }, () => {});
      fs.unwatchFile('watched.txt');
    });
    for (const [name, interval] of [
      ['nan', NaN],
      ['negative', -1],
      ['fractional', 1.5],
      ['infinity', Infinity],
      ['zero', 0],
    ]) {
      probe('watchfile-interval-' + name, () => {
        fs.watchFile('watched.txt', { interval }, () => {});
        fs.unwatchFile('watched.txt');
      });
    }
    // interval validation outranks the bigint option (rifty: the bigint gap).
    probe('watchfile-interval-before-bigint', () => {
      fs.watchFile('watched.txt', { bigint: true, interval: -1 }, () => {});
      fs.unwatchFile('watched.txt');
    });

    probe('watch-null-options', () => {
      fs.watch('watched.txt', null, () => {}).close();
    });
    probe('watch-missing-buffer-encoding', () => {
      fs.watch('missing.txt', { encoding: 'buffer' }, () => {});
    });
    probe('watch-invalid-encoding-existing', () => {
      fs.watch('watched.txt', { encoding: 'bogus' }, () => {});
    });
    probe('watch-invalid-encoding-missing', () => {
      fs.watch('missing.txt', { encoding: 'bogus' }, () => {});
    });
  `,
};

export default c;
