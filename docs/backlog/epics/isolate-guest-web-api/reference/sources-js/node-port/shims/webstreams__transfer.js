module.exports = new Proxy(
  {},
  {
    get(_, k) {
      throw new Error(`probe: webstreams/transfer.${String(k)} not in this port`);
    },
  },
);
