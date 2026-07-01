import { describe, expect, it } from 'vitest';
import { http2 } from '../../../packages/runtime-js/src/builtins/null-net-stubs.ts';

describe('node:http2 loud-throw facade', () => {
  it('imports with class identities for adapter instanceof checks', () => {
    expect(typeof http2.Http2ServerRequest).toBe('function');
    expect(http2.Http2ServerRequest.name).toBe('Http2ServerRequest');
    expect(typeof http2.Http2ServerResponse).toBe('function');
    expect(http2.Http2ServerResponse.name).toBe('Http2ServerResponse');
  });

  it('throws NotImplementedError when request/response classes are constructed', () => {
    expect(() => new http2.Http2ServerRequest()).toThrow(
      expect.objectContaining({ name: 'NotImplementedError' }),
    );
    expect(() => new http2.Http2ServerResponse()).toThrow(
      expect.objectContaining({ name: 'NotImplementedError' }),
    );
  });
});
