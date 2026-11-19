/**
 * The child's own side of the bridge (ADR-0557 §6): the output cap and the
 * `import()` rejection. Argument validation is the export's `createHostBridge`
 * (`@riftydev/isolate-guest`, ADR-0558).
 */
import { IMPORT_GAP } from '@riftydev/isolate-guest';

/**
 * The rejection a guest `import()` receives. isolated-vm copies a thrown host
 * Error's stack into the isolate, so it carries none of the child's frames (I3).
 */
export function importGapError(): Error {
  return Object.assign(new Error(IMPORT_GAP), { stack: `Error: ${IMPORT_GAP}` });
}

/** stdout/stderr bytes kept up to the cap, copied into one growable buffer per fd (memory ~ cap). */
export class OutputBudget {
  #kept = 0;
  #truncated = false;
  readonly #pending = {
    1: { buf: new Uint8Array(0), len: 0 },
    2: { buf: new Uint8Array(0), len: 0 },
  };
  constructor(readonly cap: number) {}

  get truncated(): boolean {
    return this.#truncated;
  }

  /** Accept a guest write; true when new bytes or the truncation flip await a flush. */
  write(fd: 1 | 2, bytes: Uint8Array): boolean {
    const room = this.cap - this.#kept;
    const flipped = bytes.byteLength > room && !this.#truncated;
    if (flipped) this.#truncated = true;
    const take = Math.min(room, bytes.byteLength);
    if (take <= 0) return flipped;
    const slot = this.#pending[fd];
    if (slot.len + take > slot.buf.byteLength) {
      const size = Math.max(slot.len + take, Math.min(this.cap, slot.buf.byteLength * 2 || 4096));
      const grown = new Uint8Array(size);
      grown.set(slot.buf.subarray(0, slot.len));
      slot.buf = grown;
    }
    slot.buf.set(bytes.subarray(0, take), slot.len);
    slot.len += take;
    this.#kept += take;
    return true;
  }

  /** At most one chunk per fd. */
  drain(): [1 | 2, Uint8Array][] {
    const out: [1 | 2, Uint8Array][] = [];
    for (const fd of [1, 2] as const) {
      const slot = this.#pending[fd];
      if (slot.len > 0) out.push([fd, slot.buf.slice(0, slot.len)]);
      slot.len = 0;
    }
    return out;
  }
}
