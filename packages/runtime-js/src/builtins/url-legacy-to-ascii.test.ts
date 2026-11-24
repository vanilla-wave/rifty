/**
 * ADR-0574 §3 on the runtime-js lane (Node's `URL` stands in for the host's): hostnames where the
 * `toASCII` step's neutral label and its `xn--` rule decide the result equal live Node's
 * `url.parse(…).hostname` (or its `ERR_INVALID_URL`). The browser host's full corpus:
 * tests/browser-unit/url-legacy.spec.ts.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import nodeUrl, { pathToFileURL } from 'node:url';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from '../module-loader/index.ts';

const HOSTS = [
  // WHATWG's IPv4 "ends in a number" rule (ada has none): ASCII and mapped digits.
  'ñ.1',
  'ñ.123',
  'ñ.0x7f',
  'ñ.1.',
  'ñ.1.2.3.4',
  'a.ñ.255',
  'xn--ida.1',
  '０ｘ７ｆ．１',
  'ñ.１',
  // A Unicode label whose ASCII part starts with `xn--`: ada encodes it, validates only input labels.
  'Σxn--',
  'ñxn--a',
  'aσxn--b.com',
  'ñxn--.com',
  // Input `xn--` labels stay validated.
  'xn--xn--ida',
  'ñ.xn--xn--ida',
  'ñ.xn--ida',
  'xn--ñ',
];

const outcome = (parse: (s: string) => { hostname: string | null }, host: string): unknown => {
  try {
    return parse(`http://${host}/`).hostname;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('legacy url toASCII step equals Node where its rules decide', () => {
  it('number labels and xn-- prefixed Unicode labels', () => {
    const vfs = new MemoryFsSync();
    vfs.mkdirSync('/w', { recursive: true });
    vfs.writeFileSync('/w/m.cjs', new TextEncoder().encode("module.exports = require('url');"));
    const guest = createModuleLoader(vfs).require('/w/m.cjs') as typeof nodeUrl;
    const noDeprecation = process.noDeprecation;
    process.noDeprecation = true;
    try {
      const rows = HOSTS.map((h) => [h, outcome(guest.parse, h)]);
      expect(rows).toEqual(HOSTS.map((h) => [h, outcome(nodeUrl.parse, h)]));
    } finally {
      process.noDeprecation = noDeprecation;
    }
  });
});

// A guest replacing an intrinsic the step would read live: its own process (the realm is the
// guest's, as on the isolate host), the same guest code under live Node.
// `url` is required first: rifty's loader itself reads `split` live (outside this step).
const PATCHED = `const url = require('url');
String.prototype[Symbol.split] = () => { throw new Error('guest @@split'); };
let out; try { out = JSON.stringify([url.parse('http://ñ.com/').hostname, url.parse('http://xn--ida.ñ.com/').hostname]); } catch (e) { out = 'THROW ' + e.message; }
delete String.prototype[Symbol.split];
module.exports = out;`;

describe('a guest-replaced String.prototype[Symbol.split] does not reach the step', () => {
  it('url.parse of a non-ASCII host', () => {
    const loader = pathToFileURL(resolve('packages/runtime-js/src/module-loader/index.ts')).href;
    const vfs = pathToFileURL(resolve('packages/vfs/src/internal/index.ts')).href;
    const run = (args: string[]): string =>
      execFileSync(process.execPath, args, { encoding: 'utf8' });
    const native = run([
      '--no-deprecation',
      '-e',
      `${PATCHED.replace('module.exports = out;', 'console.log(out);')}`,
    ]);
    const guest = run([
      '--no-deprecation',
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { createModuleLoader } from ${JSON.stringify(loader)};
import { MemoryFsSync } from ${JSON.stringify(vfs)};
const fs = new MemoryFsSync();
fs.loadFixture({ '/w/m.cjs': ${JSON.stringify(PATCHED)} });
console.log(createModuleLoader(fs).require('/w/m.cjs'));`,
    ]);
    expect(guest).toBe(native);
  });
});
