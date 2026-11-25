// V8 private symbols Node's C++ creates; plain symbols here.
const privateSymbols = {
  transfer_mode_private_symbol: Symbol('transfer_mode'),
  arrow_message_private_symbol: Symbol('arrow_message'),
  decorated_private_symbol: Symbol('decorated'),
};
const perIsolateSymbols = {
  messaging_clone_symbol: Symbol('messaging_clone'),
  messaging_deserialize_symbol: Symbol('messaging_deserialize'),
};
module.exports = { privateSymbols, perIsolateSymbols };
