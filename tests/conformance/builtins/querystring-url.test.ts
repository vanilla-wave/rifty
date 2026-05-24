import { describe, expect, it } from 'vitest';
import qs from '../../../packages/runtime-js/src/builtins/querystring.ts';
import url from '../../../packages/runtime-js/src/builtins/url.ts';

describe('node:querystring', () => {
  it('parses simple key=value', () => {
    expect(qs.parse('a=1&b=2')).toEqual({ a: '1', b: '2' });
  });
  it('multiple values get arrayed', () => {
    expect(qs.parse('a=1&a=2&a=3')).toEqual({ a: ['1', '2', '3'] });
  });
  it('decodes percent escapes', () => {
    expect(qs.parse('q=hello%20world')).toEqual({ q: 'hello world' });
  });
  it('stringifies object', () => {
    expect(qs.stringify({ a: 1, b: 'two three' })).toBe('a=1&b=two%20three');
  });
  it('stringifies arrays as repeated key', () => {
    expect(qs.stringify({ a: ['x', 'y'] })).toBe('a=x&a=y');
  });
});

describe('node:url', () => {
  it('parse returns components', () => {
    const u = url.parse('https://example.com:8080/a/b?x=1#h');
    expect(u.protocol).toBe('https:');
    expect(u.host).toBe('example.com:8080');
    expect(u.hostname).toBe('example.com');
    expect(u.port).toBe('8080');
    expect(u.pathname).toBe('/a/b');
    expect(u.search).toBe('?x=1');
    expect(u.hash).toBe('#h');
  });
  it('format builds a url from parts', () => {
    expect(
      url.format({
        protocol: 'https',
        host: 'example.com',
        pathname: '/x',
        search: '?a=1',
      }),
    ).toBe('https://example.com/x?a=1');
  });
  it('resolve relative path', () => {
    expect(url.resolve('https://example.com/a/b', 'c')).toBe('https://example.com/a/c');
  });
  it('exports global URL + URLSearchParams', () => {
    expect(typeof url.URL).toBe('function');
    expect(typeof url.URLSearchParams).toBe('function');
  });
  it('pathToFileURL/fileURLToPath roundtrip', () => {
    const u = url.pathToFileURL('/tmp/x');
    expect(u.toString()).toBe('file:///tmp/x');
    expect(url.fileURLToPath(u)).toBe('/tmp/x');
  });
});
