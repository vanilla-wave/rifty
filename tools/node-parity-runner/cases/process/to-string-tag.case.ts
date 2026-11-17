/**
 * Node brands `process` with an own `Symbol.toStringTag` = 'process', so
 * `String(process)` is `[object process]`; brand-based Node detectors
 * (pdfjs-dist `isNodeJS`: `process + '' === '[object process]'`) read it.
 * Default mode: `node:process` (and its ESM default) is the no-spec
 * `riftyProcess`; the free global is the host's in-process, never read.
 */
import type { ParityCase } from '../../src/types.ts';

export const BRAND_SOURCE = `
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
  code: `${BRAND_SOURCE}
    const p = require('node:process');
    const isNodeJS =
      typeof p === 'object' &&
      p + '' === '[object process]' &&
      !p.versions.nw &&
      !(p.versions.electron && p.type && p.type !== 'browser');
    import('node:process').then((ns) => {
      console.log(JSON.stringify({
        binding: brand(p),
        bare: brand(require('process')),
        esmDefault: brand(ns.default),
        sameObject: ns.default === p && require('process') === p,
        isNodeJS,
      }));
    });
  `,
} satisfies ParityCase;
