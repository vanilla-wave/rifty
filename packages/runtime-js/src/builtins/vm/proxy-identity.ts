import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';
import bootstrap from '../../internal/generated/proxy-identity.js';
import type { ContextLifetime } from './context-lifetime.ts';

/** Keep semantic Proxy identity across membrane implementation proxies. */
export function guestProxyIdentity(
  ctx: QuickJSContext,
  lifetime: ContextLifetime,
): (value: QuickJSHandle) => boolean {
  const predicate = ctx.unwrapResult(ctx.evalCode(bootstrap));
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
