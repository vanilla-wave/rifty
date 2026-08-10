import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import util, { format, formatWithOptions, inspect } from 'node:util';

    const value = { outer: { inner: 1 } };
    const descriptor = Object.getOwnPropertyDescriptor(util, 'formatWithOptions');
    console.log(formatWithOptions({ depth: 0 }, 'value=%O', value));
    console.log(formatWithOptions({ depth: 0 }, value));
    console.log(
      'relations',
      formatWithOptions({}, 'value=%O', value) === format('value=%O', value),
      formatWithOptions({ depth: 0 }, value) === inspect(value, { depth: 0 }),
      formatWithOptions === util.formatWithOptions,
    );
    console.log(
      'descriptor',
      descriptor?.enumerable,
      descriptor?.configurable,
      descriptor?.writable,
      formatWithOptions.name,
      formatWithOptions.length,
    );
    try {
      formatWithOptions(null, 'nope');
    } catch (error) {
      console.log('invalid', error.code);
    }
  `,
  expected: [
    'value={ outer: [Object] }',
    '{ outer: [Object] }',
    'relations true true true',
    'descriptor true true true formatWithOptions 1',
    'invalid ERR_INVALID_ARG_TYPE',
  ].join('\n'),
};

export default c;
