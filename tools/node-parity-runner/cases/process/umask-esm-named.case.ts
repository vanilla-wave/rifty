/** `umask` is an own enumerable `process` member, so its ESM named import links and works unbound. */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import process, { umask } from 'node:process';
    import * as ns from 'node:process';
    const d = Object.getOwnPropertyDescriptor(process, 'umask');
    console.log(JSON.stringify({
      type: typeof umask,
      same: umask === process.umask && ns.umask === umask,
      unbound: umask() === process.umask(),
      desc: d ? [typeof d.value, d.writable, d.enumerable, d.configurable] : null,
      key: Object.keys(process).includes('umask'),
      length: umask.length,
      name: umask.name,
    }));
  `,
  expected:
    '{"type":"function","same":true,"unbound":true,"desc":["function",true,true,true],"key":true,"length":1,"name":"wrappedUmask"}\n',
};

export default c;
