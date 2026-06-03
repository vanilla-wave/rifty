/**
 * Node-compatible `node:tty` (subset). We never run on a TTY in the browser.
 */
import { NotImplementedError } from '@riftydev/io';

export function isatty(_fd: number): boolean {
  return false;
}

class ReadStream {
  constructor() {
    throw new NotImplementedError('tty.ReadStream');
  }
}
class WriteStream {
  constructor() {
    throw new NotImplementedError('tty.WriteStream');
  }
}

const ttyModule = { isatty, ReadStream, WriteStream };
export default ttyModule;
