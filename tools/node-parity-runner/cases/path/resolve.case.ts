import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const path = require('node:path');
    console.log(path.posix.resolve('/foo/bar', './baz'));
    console.log(path.posix.resolve('/foo/bar', '/tmp/file'));
    console.log(path.posix.basename('/foo/bar/baz.txt'));
    console.log(path.posix.extname('/foo/bar/baz.txt'));
    console.log(path.posix.dirname('/foo/bar/baz.txt'));
  `,
};

export default c;
