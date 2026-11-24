/**
 * With `URL`/`URLSearchParams` present at load (every browser host) the runtime keeps what it loaded with:
 * the isolate guest's late-`URL` forwarder never applies, and a later replaced global changes
 * nothing (PR #440 review round 2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { URLSearchParams as urlSearchParams } from '../builtins/url.ts';
import { URLConstructor, fileURLFromResolvedPath, fileURLToPathPosix } from './posix-file-url.ts';

const loaded = globalThis.URL;
afterEach(() => {
  globalThis.URL = loaded;
});

describe('URLConstructor with URL at load', () => {
  it('is the loaded URL itself; node:url URLSearchParams the loaded global', () => {
    expect(URLConstructor).toBe(loaded);
    expect(urlSearchParams).toBe(globalThis.URLSearchParams);
  });

  it('ignores a URL global replaced after load', () => {
    globalThis.URL = function Fake() {
      throw new Error('replaced');
    } as unknown as typeof URL;
    expect(fileURLFromResolvedPath('/a b')).toBeInstanceOf(loaded);
    expect(fileURLFromResolvedPath('/a b').href).toBe('file:///a%20b');
    expect(fileURLToPathPosix('file:///a%20b')).toBe('/a b');
  });
});
