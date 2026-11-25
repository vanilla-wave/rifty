// timers: Node's Timeout has unref(); the guest binds rifty's timers (host timers, ADR-0557 §5).
module.exports = {
  setTimeout(fn, ms, ...args) {
    const id = globalThis.setTimeout(fn, ms, ...args);
    return {
      id,
      unref() {
        return this;
      },
      ref() {
        return this;
      },
      [Symbol.toPrimitive]() {
        return id;
      },
    };
  },
  clearTimeout(t) {
    if (t) globalThis.clearTimeout(t.id);
  },
};
