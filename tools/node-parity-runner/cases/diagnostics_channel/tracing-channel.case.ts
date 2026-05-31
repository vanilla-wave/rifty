import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const dc = require('node:diagnostics_channel');
    const out = [];

    // --- traceSync success: start, end (with result) ---
    {
      const tc = dc.tracingChannel('rifty:sync');
      const ev = [];
      tc.subscribe({
        start: (m) => ev.push(['start', m.foo]),
        end: (m) => ev.push(['end', m.foo, m.result]),
        error: (m) => ev.push(['error', m.foo, String(m.error)]),
      });
      out.push(['hasSubscribers', tc.hasSubscribers]);
      out.push(['names',
        tc.start.name, tc.end.name, tc.asyncStart.name, tc.asyncEnd.name, tc.error.name]);
      const r = tc.traceSync(() => 42, { foo: 'bar' });
      out.push(['sync-return', r]);
      out.push(['sync-events', ev]);
    }

    // --- traceSync error: start, error, end; rethrows ---
    {
      const tc = dc.tracingChannel('rifty:syncerr');
      const ev = [];
      tc.subscribe({
        start: () => ev.push('start'),
        end: () => ev.push('end'),
        error: (m) => ev.push(['error', String(m.error)]),
      });
      let caught;
      try { tc.traceSync(() => { throw new Error('boom'); }, {}); }
      catch (e) { caught = e.message; }
      out.push(['err-caught', caught]);
      out.push(['err-events', ev]);
    }

    console.log(JSON.stringify(out));
  `,
};

export default c;
