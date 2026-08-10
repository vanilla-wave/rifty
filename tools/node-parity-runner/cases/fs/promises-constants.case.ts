import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import fs from 'node:fs';
    import fsPromises, { constants } from 'node:fs/promises';
    import * as fsPromisesNamespace from 'node:fs/promises';

    const descriptor = Object.getOwnPropertyDescriptor(fsPromises, 'constants');
    console.log(
      'identity',
      constants === fs.constants,
      fsPromises.constants === fs.constants,
      fsPromises === fs.promises,
    );
    console.log(
      'descriptor',
      descriptor?.enumerable,
      descriptor?.configurable,
      descriptor?.writable,
      typeof descriptor?.get,
      typeof descriptor?.set,
    );
    console.log(
      'namespace',
      fsPromisesNamespace.constants === fs.constants,
      fsPromisesNamespace.default === fsPromises,
      Object.keys(fsPromisesNamespace).includes('constants'),
    );
  `,
  expected: [
    'identity true true true',
    'descriptor true true true undefined undefined',
    'namespace true true true',
  ].join('\n'),
};

export default c;
