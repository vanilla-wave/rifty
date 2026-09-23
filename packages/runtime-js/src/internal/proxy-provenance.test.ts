import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('shares one primordial authority across bundles and seals it before guest access', () => {
  const ownerUrl = new URL('./proxy-provenance.ts', import.meta.url).href;
  const globalsUrl = new URL('./worker-globals.ts', import.meta.url).href;
  const source = `
    import { RuntimeProxy, installNodeProxyProvenance, proxyCloneFailure, sealNodeProxyBootstrap } from ${JSON.stringify(ownerUrl)};
    import { readRuntimeGlobal } from ${JSON.stringify(globalsUrl)};
    const second = await import(${JSON.stringify(`${ownerUrl}?bundle=second`)});
    const original = Proxy;
    installNodeProxyProvenance();
    const tracked = new Proxy({}, {});
    const internal = new RuntimeProxy({}, {});
    const result = {
      samePrimordial: RuntimeProxy === original && second.RuntimeProxy === original,
      sharedTracking: proxyCloneFailure(tracked) === second.proxyCloneFailure(tracked),
      tracked: proxyCloneFailure(tracked), internal: proxyCloneFailure(internal) ?? null,
      sealed: false, primordialHas: false,
    };
    sealNodeProxyBootstrap();
    try { readRuntimeGlobal('proxyProvenance').acquireDuringBootstrap(); }
    catch { result.sealed = true; }
    WeakSet.prototype.has = () => false;
    result.primordialHas = proxyCloneFailure(tracked) === result.tracked;
    console.log(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
    input: source,
    encoding: 'utf8',
  });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({
    samePrimordial: true,
    sharedTracking: true,
    tracked: '#<Object> could not be cloned.',
    internal: null,
    sealed: true,
    primordialHas: true,
  });
});
