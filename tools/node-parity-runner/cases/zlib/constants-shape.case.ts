import type { ParityCase } from '../../src/types.ts';

// Pins the shape of `zlib.constants` against real Node: own key order, null
// prototype, every key enumerable + read-only + non-configurable, extensible;
// the legacy top-level aliases in the same order.
const c: ParityCase = {
  code: `
    'use strict';
    const zlib = require('node:zlib');
    const c = zlib.constants;
    console.log('proto=' + (Object.getPrototypeOf(c) === null ? 'null' : 'object'));
    console.log('frozen=' + Object.isFrozen(c) + ' extensible=' + Object.isExtensible(c));
    console.log('keys=' + Object.keys(c).join(','));
    const flags = new Set(Object.keys(c).map((k) => {
      const d = Object.getOwnPropertyDescriptor(c, k);
      return [d.enumerable, d.writable, d.configurable].join('/');
    }));
    console.log('flags=' + [...flags].join(' '));
    try { c.Z_OK = 9; console.log('write ok'); } catch (e) { console.log('write ' + e.name); }
    console.log('legacy=' + Object.getOwnPropertyNames(zlib).filter((k) => /^[A-Z_]+[A-Z0-9_]*$/.test(k) || k.startsWith('ZSTD_')).join(','));
  `,
};

export default c;
