// internal/encoding: the guest has its own TextEncoder/TextDecoder (web-shim); here the isolate's.
module.exports = { TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder };
