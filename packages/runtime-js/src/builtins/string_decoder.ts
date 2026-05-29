/**
 * Node-compatible `node:string_decoder` via TextDecoder. Only utf-8 is wired;
 * other encodings are loud.
 *
 * Implemented as a *callable* constructor (not a class) so the legacy idiom
 * `StringDecoder.call(this, enc)` works: iconv-lite's `InternalDecoder` borrows
 * StringDecoder that way and then calls `StringDecoder.prototype.write` — which
 * body-parser hits when decoding a request body. A class would throw "Class
 * constructor StringDecoder cannot be invoked without 'new'".
 */
import { NotImplementedError } from '@rifty/io';

/** Public instance shape (declaration-merged with the constructor function). */
export interface StringDecoder {
  encoding: string;
  write(buf: Uint8Array): string;
  end(buf?: Uint8Array): string;
}

/** Instance state, including the TextDecoder carried on `this`. */
interface DecoderThis extends StringDecoder {
  _decoder: TextDecoder;
}

export function StringDecoder(this: DecoderThis, encoding = 'utf8'): void {
  const enc = encoding.toLowerCase().replace('-', '');
  if (enc !== 'utf8' && enc !== 'utf-8') {
    throw new NotImplementedError(`string_decoder encoding '${encoding}'`);
  }
  this.encoding = 'utf8';
  this._decoder = new TextDecoder('utf-8');
}

StringDecoder.prototype.write = function write(this: DecoderThis, buf: Uint8Array): string {
  return this._decoder.decode(buf, { stream: true });
};

StringDecoder.prototype.end = function end(this: DecoderThis, buf?: Uint8Array): string {
  return this._decoder.decode(buf ?? new Uint8Array(0));
};

const stringDecoderModule = { StringDecoder };
export default stringDecoderModule;
