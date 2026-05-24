import type { ParityCase } from '../../src/types.ts';

/**
 * Top-level `await` in an ESM module. Both runtimes must evaluate the awaited
 * promise before the module is considered settled, then run the subsequent
 * synchronous statements with the resolved value in scope.
 */
const c: ParityCase = {
  kind: 'esm',
  code: `
    const value = await Promise.resolve(42);
    console.log('value:' + value);
    const next = await Promise.resolve(value + 1);
    console.log('next:' + next);
  `,
};

export default c;
