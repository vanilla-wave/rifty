import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const a = Buffer.from('foo');
    const b = Buffer.from('bar');
    const c = Buffer.concat([a, b]);
    console.log(c.toString('utf8'));
    console.log(Buffer.from('foo').equals(Buffer.from('foo')));
    console.log(Buffer.from('foo').equals(Buffer.from('bar')));
    console.log(Buffer.isBuffer(a));
    console.log(Buffer.isBuffer('plain string'));
  `,
};

export default c;
