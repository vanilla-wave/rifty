import { Buffer } from './buffer.ts';

/**
 * Incremental bytes→string converter for the read-stream `encoding` option.
 * A chunk boundary must not split an encoding unit (Node routes through
 * StringDecoder): utf8 decodes via a streaming TextDecoder; utf16le/base64
 * carry the remainder to the next chunk; single-byte encodings pass through.
 */
export class ChunkDecoder {
  private readonly enc: string;
  private readonly utf8: TextDecoder | null;
  private readonly unit: number;
  private carry: Uint8Array = new Uint8Array();

  constructor(enc: string) {
    this.enc = enc;
    const low = enc.toLowerCase();
    // Unknown encodings throw here (loud, sync, as Node's createReadStream).
    (Buffer.from(new Uint8Array()) as Uint8Array & { toString(e?: string): string }).toString(enc);
    const utf8 = low === 'utf8' || low === 'utf-8';
    this.utf8 = utf8 ? new TextDecoder('utf-8', { ignoreBOM: true }) : null; // Node keeps BOM
    this.unit =
      low === 'utf16le' || low === 'utf-16le' || low === 'ucs2' || low === 'ucs-2'
        ? 2
        : low === 'base64' || low === 'base64url'
          ? 3
          : 1;
  }

  decode(bytes: Uint8Array): string {
    if (this.utf8) return this.utf8.decode(bytes, { stream: true });
    let buf = bytes;
    if (this.carry.length > 0) {
      const merged = new Uint8Array(this.carry.length + bytes.length);
      merged.set(this.carry, 0);
      merged.set(bytes, this.carry.length);
      buf = merged;
      this.carry = new Uint8Array();
    }
    const rem = this.unit === 1 ? 0 : buf.length % this.unit;
    if (rem > 0) {
      this.carry = buf.slice(buf.length - rem);
      buf = buf.subarray(0, buf.length - rem);
    }
    if (buf.length === 0) return '';
    return (Buffer.from(buf) as Uint8Array & { toString(e?: string): string }).toString(this.enc);
  }

  flush(): string {
    if (this.utf8) return this.utf8.decode();
    if (this.carry.length === 0) return '';
    const tail = this.carry;
    this.carry = new Uint8Array();
    return (Buffer.from(tail) as Uint8Array & { toString(e?: string): string }).toString(this.enc);
  }
}
