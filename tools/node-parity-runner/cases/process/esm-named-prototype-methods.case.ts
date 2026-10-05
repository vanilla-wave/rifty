import type { ParityCase } from '../../src/types.ts';

// runtime-js/builtin-static-names-prototype-methods: a class-backed builtin's
// static ESM export names include its prototype methods. tinyexec does
// `import { cwd } from 'node:process'`; Node resolves it, rifty's Object.keys
// static-name set misses prototype members → link-time SyntaxError.
// Own-name baseline (argv/env) guards the same key collection the unit
// rewrites; the identity line pins the LIVE member (default vs named binding).
const c: ParityCase = {
  kind: 'esm',
  code: `
    import { cwd, nextTick, argv, env } from 'node:process';
    import process from 'node:process';
    console.log(typeof cwd());
    console.log(typeof nextTick);
    console.log(Array.isArray(argv));
    console.log(typeof env === 'object' && env !== null);
    console.log(process.cwd === cwd);
  `,
};

export default c;
