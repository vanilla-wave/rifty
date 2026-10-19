import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';
import { createProxyIdentity } from '../../internal/proxy-identity.ts';
import type { ContextLifetime } from './context-lifetime.ts';

/** Keep semantic Proxy identity across membrane implementation proxies. */
export function guestProxyIdentity(
  ctx: QuickJSContext,
  lifetime: ContextLifetime,
): (value: QuickJSHandle) => boolean {
  const predicate = ctx.unwrapResult(ctx.evalCode(`(${createProxyIdentity.toString()})().isProxy`));
  lifetime.trackInfra(predicate);
  return (value) => {
    const result = ctx.unwrapResult(ctx.callFunction(predicate, ctx.undefined, value));
    try {
      return ctx.dump(result) as boolean;
    } finally {
      result.dispose();
    }
  };
}
