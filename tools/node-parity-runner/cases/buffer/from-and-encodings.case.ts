import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const b = Buffer.from('hello', 'utf8');
    console.log(b.toString('hex'));
    console.log(b.toString('base64'));
    console.log(Buffer.byteLength('пр'));
    const c = Buffer.concat([Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]);
    console.log(c.toString('utf8'));
  `,
};

export default c;
