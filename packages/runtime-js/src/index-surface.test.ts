import { describe, expect, it } from 'vitest';
import * as runtime from './index.ts';

describe('@riftydev/runtime-js public surface', () => {
  it('exposes the realm keepalive installers and no guest promise pin (ADR-0530)', () => {
    expect(typeof runtime.installFetchKeepalive).toBe('function');
    expect(typeof runtime.installHostAsyncKeepalive).toBe('function');
    expect(Object.keys(runtime)).not.toContain('trackKeepalivePromise');
  });
});
