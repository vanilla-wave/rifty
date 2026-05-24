/**
 * Node-compatible `node:string_decoder` via TextDecoder. Only utf-8 is wired;
 * other encodings are loud.
 */
import { NotImplementedError } from '@rifty/io';

export class StringDecoder {
  private readonly decoder: TextDecoder;
  readonly encoding: string;

  constructor(encoding = 'utf8') {
    const enc = encoding.toLowerCase().replace('-', '');
    if (enc !== 'utf8' && enc !== 'utf-8') {
      throw new NotImplementedError(`string_decoder encoding '${encoding}'`);
    }
    this.encoding = 'utf8';
    this.decoder = new TextDecoder('utf-8');
  }

  write(buf: Uint8Array): string {
    return this.decoder.decode(buf, { stream: true });
  }

  end(buf?: Uint8Array): string {
    return this.decoder.decode(buf ?? new Uint8Array(0));
  }
}

const stringDecoderModule = { StringDecoder };
export default stringDecoderModule;
