import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const path = require('node:path');
    console.log(path.posix.join('a', 'b', 'c'));
    console.log(path.posix.join('/x/', '/y/', 'z'));
    console.log(path.posix.join('foo', '..', 'bar'));
    console.log(path.posix.join('.'));
    console.log(path.posix.join('', './'));
    console.log(path.posix.join('foo', '../'));
    console.log(path.posix.join('foo', '..', './'));
    console.log(path.posix.join('..', './'));
    console.log(path.posix.join('../..', './'));
    console.log(path.posix.join('foo/', 'bar/'));
    console.log(path.posix.join('/', './'));
  `,
};

export default c;
