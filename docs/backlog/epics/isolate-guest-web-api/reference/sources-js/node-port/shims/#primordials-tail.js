// isPromisePending (webstreams/util) asks V8 for a promise's state; JS cannot. Every promise it
// asks about comes from PromiseWithResolvers (pending until settled) or PromiseResolve/Reject
// (settled at birth): track the former. A generator would make this an anchored edit.
const pendingPromises = new WeakSet();
const nativeWithResolvers = primordials.PromiseWithResolvers;
primordials.PromiseWithResolvers = function PromiseWithResolvers() {
  const r = nativeWithResolvers();
  pendingPromises.add(r.promise);
  const { resolve, reject } = r;
  r.resolve = (v) => {
    pendingPromises.delete(r.promise);
    resolve(v);
  };
  r.reject = (e) => {
    pendingPromises.delete(r.promise);
    reject(e);
  };
  return r;
};
primordials.__pendingPromises = pendingPromises;
