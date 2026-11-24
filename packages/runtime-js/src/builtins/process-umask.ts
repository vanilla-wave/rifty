/**
 * `process.umask` — Node's `wrappedUmask` → `parseFileMode('mask')`. Reports the
 * mask the VFS creates under (`VFS_UMASK`); the VFS applies no mode, so setting
 * any other mask is a loud gap, never a silent accept.
 */
import { NotImplementedError } from '@riftydev/vfs';
import { invalidArgType, outOfRange } from '../internal/node-received.ts';
import { inspect } from '../repl/inspect.ts';
import { VFS_UMASK } from './fs-stats.ts';

function parseMask(value: unknown): number {
  let mask = value ?? undefined;
  if (typeof mask === 'string') {
    if (!/^[0-7]+$/.test(mask)) {
      const shown = inspect(mask);
      throw Object.assign(
        new TypeError(
          `The argument 'mask' must be a 32-bit unsigned integer or an octal string. Received ${shown.length > 128 ? `${shown.slice(0, 128)}...` : shown}`,
        ),
        { code: 'ERR_INVALID_ARG_VALUE' },
      );
    }
    mask = Number.parseInt(mask, 8);
  }
  if (typeof mask !== 'number') throw invalidArgType('"mask" argument', 'of type number', mask);
  if (!Number.isInteger(mask)) throw outOfRange('mask', 'an integer', mask);
  if (mask < 0 || mask > 0xffffffff) throw outOfRange('mask', '>= 0 && <= 4294967295', mask);
  return mask;
}

export function wrappedUmask(mask?: unknown): number {
  if (mask !== undefined && parseMask(mask) !== VFS_UMASK) {
    throw new NotImplementedError('process.umask(mask)', 'the rifty VFS applies no file modes');
  }
  return VFS_UMASK;
}
