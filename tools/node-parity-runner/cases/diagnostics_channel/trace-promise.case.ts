import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const dc = require('node:diagnostics_channel');
    const tc = dc.tracingChannel('rifty:promise');
    const ev = [];
    tc.subscribe({
      start: () => ev.push('start'),
      end: () => ev.push('end'),
      asyncStart: (m) => ev.push(['asyncStart', m.result]),
      asyncEnd: (m) => ev.push(['asyncEnd', m.result]),
      error: (m) => ev.push(['error', String(m.error)]),
    });
    tc.tracePromise(async () => 'ok', {}).then((v) => {
      ev.push(['resolved', v]);
      console.log(JSON.stringify(ev));
    });
  `,
};

export default c;
