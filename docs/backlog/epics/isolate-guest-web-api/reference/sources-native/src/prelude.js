// The isolate guest's own globals that candidates may need (packages/isolate-guest/src/guest/web-shim.ts):
// its UTF-8 TextEncoder/TextDecoder (imported from the guest source) and a copy of its DOMException.
import {
  TextDecoder,
  TextEncoder,
} from '../../../../../../../packages/isolate-guest/src/guest/text-codec.ts';

const LEGACY_CODES = {
  InvalidCharacterError: 5,
  NotSupportedError: 9,
  InvalidStateError: 11,
  SyntaxError: 12,
  AbortError: 20,
  DataCloneError: 25,
};
class DOMException extends Error {
  #name;
  constructor(message = '', name = 'Error') {
    super(String(message));
    this.#name = String(name);
  }
  get name() {
    return this.#name;
  }
  get code() {
    return LEGACY_CODES[this.#name] ?? 0;
  }
}
for (const [name, value] of Object.entries({ DOMException, TextEncoder, TextDecoder })) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
