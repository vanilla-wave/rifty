import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const u = new URL('https://user:pass@example.com:8080/p/q?x=1#frag');
    console.log(u.protocol);
    console.log(u.host);
    console.log(u.pathname);
    console.log(u.searchParams.get('x'));
    console.log(u.hash);
  `,
};

export default c;
