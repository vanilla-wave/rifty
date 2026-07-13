import type { ParityCase } from '../../src/types.ts';

/** Seeded stdout shares one FIFO with console; stderr stays outside returned stdout. */
const c: ParityCase = {
  stdin: [],
  expected: 'raw-before|console\nraw-after',
  code: `
    process.stdout.write('raw-before|');
    console.log('console');
    process.stderr.write('hidden-raw-stderr');
    console.error('hidden-console-stderr');
    process.stdout.write('raw-after');
    process.stdin.resume();
  `,
};

export default c;
