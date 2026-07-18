import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'a/b.mjs': 'export const nested = true;\n',
      'dir #?% ü~/mod.mjs': `
        const moduleTail = '/dir%20%23%3F%25%20%C3%BC%7E/mod.mjs';
        const assetTail = '/dir%20%23%3F%25%20%C3%BC%7E/asset.txt';
        console.log(new URL(import.meta.url).pathname.endsWith(moduleTail));
        console.log(
          new URL(import.meta.resolve('./asset.txt')).pathname.endsWith(assetTail),
        );
        export const loaded = true;
      `,
      'dir #?% ü~/asset.txt': 'asset',
    },
  },
  code: `
    const encodedSlash = new URL('./a%2Fb.mjs', import.meta.url);
    try {
      await import(encodedSlash.href);
      console.log('LOADED');
    } catch (error) {
      console.log(error.code);
    }

    const moduleUrl = new URL(
      './dir%20%23%3F%25%20%C3%BC%7E/mod.mjs',
      import.meta.url,
    );
    const module = await import(moduleUrl.href);
    console.log(module.loaded);
  `,
  expected: 'ERR_INVALID_MODULE_SPECIFIER\ntrue\ntrue\ntrue\n',
};

export default c;
