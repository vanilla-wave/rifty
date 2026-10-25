/**
 * Guard: members Node keeps off the process own surface (inherited
 * EventEmitter methods, rifty-only host hooks) are not `node:process` ESM
 * exports — a link-time SyntaxError, as in Node.
 */
import type { ParityCase } from '../../src/types.ts';

const offSurface = [
  'on',
  'emit',
  'addListener',
  'prependListener',
  'removeListener',
  'removeAllListeners',
  'listenerCount',
  'pushStdin',
];

const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: Object.fromEntries(
      offSurface.map((name) => [`off-${name}.mjs`, `import { ${name} } from 'node:process';\n`]),
    ),
  },
  code: `
    import process from 'node:process';
    const out = [];
    for (const name of ${JSON.stringify(offSurface)}) {
      try {
        await import('./off-' + name + '.mjs');
        out.push(name + ':linked');
      } catch (e) {
        out.push(name + ':' + e.name + ':' + e.message.includes("does not provide an export named '" + name + "'"));
      }
    }
    console.log(out.join(' '));
    console.log(JSON.stringify(${JSON.stringify(offSurface)}.map((k) => Object.hasOwn(process, k))));
  `,
};

export default c;
