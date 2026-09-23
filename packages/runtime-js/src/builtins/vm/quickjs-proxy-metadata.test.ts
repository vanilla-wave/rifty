import { beforeAll, expect, it } from 'vitest';
import { proxyCloneFailure } from '../../internal/proxy-provenance.ts';
import { Membrane } from './membrane.ts';
import { ensureVmEngineReady, getQuickJsModuleSync } from './quickjs-loader.ts';

beforeAll(ensureVmEngineReady);

it('keeps eager metadata private, tamper-resistant, identity-stable and lifetime-owned', () => {
  const ctx = getQuickJsModuleSync().newContext();
  const evaluate = (source: string) => ctx.unwrapResult(ctx.evalCode(source));
  const globals = () => {
    const handle = evaluate(
      'JSON.stringify([Object.getOwnPropertyNames(globalThis), Object.getOwnPropertySymbols(globalThis)])',
    );
    try {
      return ctx.getString(handle);
    } finally {
      handle.dispose();
    }
  };
  const before = globals();
  const membrane = new Membrane(ctx);
  expect(globals()).toBe(before);
  const original = { value: 1 };
  const seed = membrane.marshalHostToGuest(original);
  expect(membrane.wrapGuestToHost(seed)).toBe(original);
  const plain = evaluate('({value:2})');
  const proxy = evaluate('globalThis.pair=Proxy.revocable({},{}); pair.proxy');
  const plainWrapper = membrane.wrapGuestToHost(plain) as object;
  const proxyWrapper = membrane.wrapGuestToHost(proxy) as object;
  expect(membrane.wrapGuestToHost(proxy)).toBe(proxyWrapper);
  const roundtrip = membrane.marshalHostToGuest(proxyWrapper);
  expect(ctx.eq(roundtrip, proxy)).toBe(true);
  expect(proxyCloneFailure(plainWrapper)).toBeUndefined();
  expect(proxyCloneFailure(proxyWrapper)).toBe('[object Object] could not be cloned.');
  evaluate(
    'pair.revoke(); WeakMap.prototype.get=()=>999; WeakMap.prototype.set=()=>{}; WeakSet.prototype.has=()=>false; void 0',
  ).dispose();
  expect(proxyCloneFailure(proxyWrapper)).toBe('null could not be cloned.');
  expect(membrane.wrapGuestToHost(seed)).toBe(original);
  expect(membrane.wrapGuestToHost(plain)).toBe(plainWrapper);
  roundtrip.dispose();
  seed.dispose();
  plain.dispose();
  proxy.dispose();
  membrane.lifetime.markPending();
  expect(membrane.lifetime.disposed).toBe(false);
  membrane.lifetime.releaseWrapper(plainWrapper);
  membrane.lifetime.releaseWrapper(proxyWrapper);
  expect(membrane.lifetime.disposed).toBe(true);
});
