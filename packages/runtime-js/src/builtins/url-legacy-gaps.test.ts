/**
 * ADR-0574 Acceptance 9 (runtime-js lane, a global `URL`): `node:url` members outside the legacy
 * port are named gaps, and `url.format(URL, options)` throws only where an option would change
 * Node's output (Node v24.16.0 for that input, in the comment of each row).
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from '../module-loader/index.ts';

type Url = {
  format(u: unknown, o?: unknown): string;
  domainToASCII(d: string): string;
  domainToUnicode(d: string): string;
  urlToHttpOptions(u: unknown): unknown;
};
const guestUrl = (): Url => {
  const vfs = new MemoryFsSync();
  vfs.mkdirSync('/w', { recursive: true });
  vfs.writeFileSync('/w/m.cjs', new TextEncoder().encode("module.exports = require('url');"));
  return createModuleLoader(vfs).require('/w/m.cjs') as Url;
};
const thrown = (f: () => unknown): unknown => {
  try {
    return { value: f() };
  } catch (e) {
    const error = e as { name?: string; message?: string };
    return { name: error.name, message: error.message };
  }
};
const gap = (feature: string) => ({
  name: 'NotImplementedError',
  message: expect.stringMatching(new RegExp(`^Not implemented: ${feature.replace('.', '\\.')}`)),
});

describe('node:url named gaps (Acceptance 9)', () => {
  it('domainToASCII, domainToUnicode, urlToHttpOptions are functions that throw their name', () => {
    const url = guestUrl();
    for (const name of ['domainToASCII', 'domainToUnicode', 'urlToHttpOptions'] as const) {
      expect(typeof url[name]).toBe('function');
      // Node: 'a.com', 'a.com', { protocol: 'http:', … }
      expect(thrown(() => url[name]('a.com' as never))).toEqual(gap(`url.${name}`));
    }
  });

  it('format(URL, options): the gap only where an option changes the output', () => {
    const url = guestUrl();
    const u = new URL('http://u:p@xn--ida.com/?q#h');
    // Node: 'http://u:p@xn--ida.com/?q', '…/#h', 'http://xn--ida.com/?q#h', 'http://u:p@ñ.com/?q#h'
    for (const options of [
      { fragment: false },
      { search: false },
      { auth: false },
      { unicode: true },
    ])
      expect(thrown(() => url.format(u, options))).toEqual(gap('url.format.options'));
    // Node: href for each (nothing to drop or convert)
    const plain = new URL('http://a.com/x');
    for (const options of [
      { fragment: false },
      { search: false },
      { auth: false },
      { unicode: true },
    ])
      expect(thrown(() => url.format(plain, options))).toEqual({ value: 'http://a.com/x' });
    // Node: 'http://a.com/x' — an empty fragment is dropped too
    expect(thrown(() => url.format(new URL('http://a.com/x#'), { fragment: false }))).toEqual(
      gap('url.format.options'),
    );
    // Node: '…?' inside the fragment only — search: false changes nothing
    expect(thrown(() => url.format(new URL('http://a.com/x#a?b'), { search: false }))).toEqual({
      value: 'http://a.com/x#a?b',
    });
  });
});
