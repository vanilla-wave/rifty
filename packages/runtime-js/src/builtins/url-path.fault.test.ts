import { afterEach, describe, expect, it } from 'vitest';
import { setProcessCwd } from './process.ts';
import { fileURLToPath, pathToFileURL } from './url.ts';

function thrown(action: () => unknown): Error & { readonly code?: string } {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`expected Error, received ${String(error)}`);
  }
  throw new Error('expected action to throw');
}

afterEach(() => {
  setProcessCwd('/workspace');
});

describe('node:url POSIX file-path conversion', () => {
  // Fault classes: sibling-drift × frozen-assumption. One Node oracle covers
  // both conversion directions and characters that URL syntax would consume.
  it('round-trips reserved, encoded-looking, Unicode, surrogate, and trailing path bytes', () => {
    setProcessCwd('/app');
    const cases = [
      {
        path: '/a b/#q?/%2F/ü',
        href: 'file:///a%20b/%23q%3F/%252F/%C3%BC',
        roundTrip: '/a b/#q?/%2F/ü',
      },
      { path: '/a/', href: 'file:///a/', roundTrip: '/a/' },
      {
        path: '/a//x/../~\\b/',
        href: 'file:///a/%7E%5Cb/',
        roundTrip: '/a/~\\b/',
      },
      {
        path: '/[]^|`{}<>"',
        href: 'file:///%5B%5D%5E%7C%60%7B%7D%3C%3E%22',
        roundTrip: '/[]^|`{}<>"',
      },
      { path: '/back\\slash/%', href: 'file:///back%5Cslash/%25', roundTrip: '/back\\slash/%' },
      {
        path: `/bad-${String.fromCharCode(0xd800)}`,
        href: 'file:///bad-%EF%BF%BD',
        roundTrip: '/bad-�',
      },
      {
        path: 'nested #?% ü/',
        href: 'file:///app/nested%20%23%3F%25%20%C3%BC/',
        roundTrip: '/app/nested #?% ü/',
      },
    ] as const;

    for (const testCase of cases) {
      const url = pathToFileURL(testCase.path);
      expect(url.href).toBe(testCase.href);
      expect(fileURLToPath(url)).toBe(testCase.roundTrip);
    }
  });

  it('rejects non-local, non-file, and encoded-separator URL siblings with Node codes', () => {
    expect(fileURLToPath('file://localhost/a')).toBe('/a');
    expect(fileURLToPath('file:///a%5Cb')).toBe('/a\\b');
    expect(thrown(() => fileURLToPath('file://host/a'))).toMatchObject({
      name: 'TypeError',
      code: 'ERR_INVALID_FILE_URL_HOST',
    });
    for (const encodedSlash of ['%2F', '%2f']) {
      expect(thrown(() => fileURLToPath(`file:///a/${encodedSlash}/b`))).toMatchObject({
        name: 'TypeError',
        code: 'ERR_INVALID_FILE_URL_PATH',
      });
    }
    expect(thrown(() => fileURLToPath('https://example.test/a'))).toMatchObject({
      name: 'TypeError',
      code: 'ERR_INVALID_URL_SCHEME',
    });
    expect(thrown(() => fileURLToPath('file://host/a%2Fb'))).toMatchObject({
      name: 'TypeError',
      code: 'ERR_INVALID_FILE_URL_HOST',
    });
  });

  it('does not consult guest replacements for URL or URI conversion globals', () => {
    const originalURL = globalThis.URL;
    const originalEncodeURI = globalThis.encodeURI;
    const originalDecodeURIComponent = globalThis.decodeURIComponent;
    const observations: string[] = [];
    Object.defineProperty(globalThis, 'URL', {
      configurable: true,
      writable: true,
      value: class HostileURL {
        constructor(value: string) {
          observations.push(`URL:${value}`);
          throw new Error('guest URL constructor');
        }
      },
    });
    globalThis.encodeURI = (value: string): string => {
      observations.push(`encode:${value}`);
      throw new Error('guest encodeURI');
    };
    globalThis.decodeURIComponent = (value: string): string => {
      observations.push(`decode:${value}`);
      throw new Error('guest decodeURIComponent');
    };
    try {
      expect(pathToFileURL('/a #?% ü').href).toBe('file:///a%20%23%3F%25%20%C3%BC');
      expect(fileURLToPath('file:///a%20%23%3F%25%20%C3%BC')).toBe('/a #?% ü');
    } finally {
      Object.defineProperty(globalThis, 'URL', {
        configurable: true,
        writable: true,
        value: originalURL,
      });
      globalThis.encodeURI = originalEncodeURI;
      globalThis.decodeURIComponent = originalDecodeURIComponent;
    }
    expect(observations).toEqual([]);
  });
});
