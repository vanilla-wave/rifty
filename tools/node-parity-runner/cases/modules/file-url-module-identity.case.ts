import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'a/b.mjs': 'export const nested = true;\n',
      'a\\b.mjs': 'export const backslash = true;\n',
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
      'mixed-case.mjs': 'export const loadedWithMixedCase = true;\n',
    },
  },
  code: `
    for (const specifier of ['./a%2Fb.mjs', './a%5Cb.mjs']) {
      try {
        await import(new URL(specifier, import.meta.url).href);
        console.log('LOADED');
      } catch (error) {
        console.log(error.code);
      }
    }

    const moduleUrl = new URL(
      './dir%20%23%3F%25%20%C3%BC%7E/mod.mjs',
      import.meta.url,
    );
    const module = await import(moduleUrl.href);
    console.log(module.loaded);

    const canonical = new URL('./mixed-case.mjs', import.meta.url).href;
    const mixedCase = canonical.replace(/^file:/, 'FiLe:');
    try {
      const [canonicalModule, mixedCaseModule] = await Promise.all([
        import(canonical),
        import(mixedCase),
      ]);
      console.log(canonicalModule === mixedCaseModule);
      console.log(mixedCaseModule.loadedWithMixedCase);
    } catch (error) {
      console.log(error.code);
    }
    try { console.log(import.meta.resolve(mixedCase).startsWith('file:')); }
    catch (error) { console.log(error.code); }
    try { console.log(import.meta.resolve('NoDe:not-real')); }
    catch (error) { console.log(error.code); }
  `,
  expected:
    'ERR_INVALID_MODULE_SPECIFIER\nERR_INVALID_MODULE_SPECIFIER\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\nNoDe:not-real\n',
};

export default c;
