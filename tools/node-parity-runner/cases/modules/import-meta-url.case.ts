import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'dir/mod.mjs': `
        const url = new URL('./asset.txt', import.meta.url);
        console.log(import.meta.url.startsWith('file:'));
        console.log(url.pathname.endsWith('/dir/asset.txt'));
      `,
      'dir/asset.txt': 'asset',
    },
  },
  code: `
    import './dir/mod.mjs';
  `,
  expected: 'true\ntrue\n',
};

export default c;
