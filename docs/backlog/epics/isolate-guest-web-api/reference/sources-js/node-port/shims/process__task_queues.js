module.exports = {
  queueMicrotask: globalThis.queueMicrotask ?? ((f) => Promise.resolve().then(f)),
};
