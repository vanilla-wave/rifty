import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'config one.mjs': "export const value = 'file-url-import';\n",
    },
  },
  code: `
    const url = new URL('./config one.mjs?mtime=123#hash', import.meta.url);
    const m = await import(url.href);
    console.log(m.value);
  `,
};

export default c;
