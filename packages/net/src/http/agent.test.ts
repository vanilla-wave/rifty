import nativeHttp from 'node:http';
import { describe, expect, it } from 'vitest';
import http, * as facade from '../http.ts';
import { http as publicHttp } from '../index.ts';
import * as layer from './index.ts';

describe('http.Agent capability ceiling', () => {
  it('allows the same subclass declaration as Node before socket use', () => {
    expect(typeof http.Agent).toBe(typeof nativeHttp.Agent);
    for (const Agent of [nativeHttp.Agent, http.Agent]) {
      expect(() => class extends Agent {}).not.toThrow();
    }
  });

  it('exposes one constructor through the default and named HTTP facades', () => {
    expect(typeof facade.Agent).toBe('function');
    expect(facade.Agent).toBe(http.Agent);
    expect(layer.Agent).toBe(http.Agent);
    expect(layer.default.Agent).toBe(http.Agent);
    expect(publicHttp.Agent).toBe(http.Agent);
  });

  it('refuses direct and inherited construction with the named socket-pool ceiling', () => {
    expect(() => new http.Agent({ keepAlive: true })).toThrowError(
      expect.objectContaining({ name: 'NotImplementedError', feature: 'node:http.Agent' }),
    );
    class DerivedAgent extends http.Agent {}
    expect(() => new DerivedAgent()).toThrowError(
      expect.objectContaining({ name: 'NotImplementedError', feature: 'node:http.Agent' }),
    );
  });
});
