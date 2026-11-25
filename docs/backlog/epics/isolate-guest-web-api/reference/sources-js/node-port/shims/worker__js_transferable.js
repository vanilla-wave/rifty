// Transfer/clone (postMessage, structuredClone): C++ messaging. tee({cloneForBranch2}) and transfer reach it.
module.exports = {
  kDeserialize: Symbol('kDeserialize'),
  kTransfer: Symbol('kTransfer'),
  kTransferList: Symbol('kTransferList'),
  kClone: Symbol('kClone'),
  markTransferMode() {},
  structuredClone() {
    throw new Error('probe: structuredClone not in this port');
  },
};
