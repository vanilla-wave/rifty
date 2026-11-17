/**
 * Node brands `process` with an own `Symbol.toStringTag` = 'process', so
 * `String(process)` is `[object process]`; brand-based Node detectors
 * (pdfjs-dist `isNodeJS`: `process + '' === '[object process]'`) read it.
 * Owner via the `node:process` binding and its ESM default (the free global is
 * the host's in-process), plus a same-realm spawned child's own `process`.
 */
import type { ParityCase } from '../../src/types.ts';

const BRAND = `
  const brand = (p) => {
    const own = Object.getOwnPropertyDescriptor(p, Symbol.toStringTag);
    return {
      str: String(p),
      tag: Object.prototype.toString.call(p),
      concat: p + '',
      own: own && [own.value, own.writable, own.enumerable, own.configurable],
      protoTag: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(p), Symbol.toStringTag) !== undefined,
      enumerable: Object.prototype.propertyIsEnumerable.call(p, Symbol.toStringTag),
    };
  };
`;

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/child.js': `${BRAND}
        process.stdout.write(JSON.stringify({
          free: brand(process),
          binding: brand(require('node:process')),
          bare: brand(require('process')),
        }));
      `,
    },
  },
  code: `${BRAND}
    const { spawn } = require('node:child_process');
    const p = require('node:process');
    const isNodeJS =
      typeof p === 'object' &&
      p + '' === '[object process]' &&
      !p.versions.nw &&
      !(p.versions.electron && p.type && p.type !== 'browser');
    import('node:process').then((ns) => {
      const owner = {
        binding: brand(p),
        bare: brand(require('process')),
        esmDefault: brand(ns.default),
        sameObject: ns.default === p && require('process') === p,
        isNodeJS,
      };
      const child = spawn('node', ['child.js'], { stdio: 'pipe' });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk.toString(); });
      child.on('close', (code) => {
        console.log(JSON.stringify(owner));
        console.log(code, out);
      });
    });
  `,
} satisfies ParityCase;
