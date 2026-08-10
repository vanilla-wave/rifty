import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import { promisify } from 'node:util';

    void (async () => {
      for (const customValue of [null, false, 0, '']) {
        const original = Object.defineProperty(
          (callback) => callback(null, 'ordinary'),
          promisify.custom,
          { value: customValue },
        );
        const wrapped = promisify(original);
        console.log('falsy', JSON.stringify(customValue), wrapped === original, await wrapped());
      }

      const invalid = Object.defineProperty(() => undefined, promisify.custom, { value: 1 });
      try {
        promisify(invalid);
      } catch (error) {
        console.log('truthy-invalid', error.name, error.code);
      }
    })();
  `,
  expected: [
    'falsy null false ordinary',
    'falsy false false ordinary',
    'falsy 0 false ordinary',
    'falsy "" false ordinary',
    'truthy-invalid TypeError ERR_INVALID_ARG_TYPE',
  ].join('\n'),
};

export default c;
