import { describe, expect, it } from 'vitest';
import { createPreviewRouteSet } from './preview-route-set.ts';

describe('preview route set', () => {
  it('keys routes by owner token, port, and scope without remounting survivors', () => {
    const mounts: string[] = [];
    const tears: string[] = [];
    const routes = createPreviewRouteSet({
      mountBridge: (port, token, scope) => {
        const key = `${token}:${port}:${scope ?? ''}`;
        mounts.push(key);
        return () => tears.push(key);
      },
    });

    routes.reconcile('a', [{ port: 5173 }]);
    routes.reconcile('a', [{ port: 5173 }, { port: 5173, previewScope: '/nested/' }]);
    routes.reconcile('b', [{ port: 5173 }]);

    expect(mounts).toEqual(['a:5173:', 'a:5173:/nested/', 'b:5173:']);
    expect(tears).toEqual(['a:5173:', 'a:5173:/nested/']);
    routes.dispose();
    expect(tears).toEqual(['a:5173:', 'a:5173:/nested/', 'b:5173:']);
  });

  it('attempts every teardown and rejects further use after dispose', () => {
    const tears: number[] = [];
    const routes = createPreviewRouteSet({
      mountBridge: (port) => () => {
        tears.push(port);
        if (port === 1) throw new Error('first route failed');
      },
    });
    routes.reconcile('owner', [{ port: 1 }, { port: 2 }]);

    expect(() => routes.dispose()).toThrow(/first route failed/);
    expect(tears).toEqual([1, 2]);
    expect(() => routes.reconcile('owner', [])).toThrow(/disposed/);
  });
});
