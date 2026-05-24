import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const path = require('node:path');
    console.log(path.posix.normalize('/foo/./bar/../baz//qux/'));
    console.log(path.posix.normalize('a/b/c/../../d'));
    console.log(path.posix.relative('/a/b/c', '/a/d/e'));
    console.log(path.posix.relative('/a/b/c', '/a/b/c/d/e'));
  `,
};

export default c;
