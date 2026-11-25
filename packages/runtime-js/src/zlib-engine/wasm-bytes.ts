/** ADR-0573: the committed zlib.wasm (generated/, sha256 in generated/sources.json) as bytes. */
import { ZLIB_WASM_BASE64 } from './generated/zlib-wasm.js';

export function zlibWasmBytes(): Uint8Array {
  const text = atob(ZLIB_WASM_BASE64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
