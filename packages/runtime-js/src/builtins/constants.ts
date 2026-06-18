import { constants as cryptoConstants } from './crypto.ts';
import { constants as fsConstants } from './fs.ts';
import { constants as osConstants } from './os.ts';

type NodeConstantValue = number | string;

// ADR-0153: `node:constants` is the faithful flattened union of fs + os + crypto constants —
// a frozen plain object that returns the real number for a known key and `undefined` for an
// absent one, exactly like real Node. The honest unimplemented-BEHAVIOR gap lives at the
// syscall boundary (`fs.open`/`copyFile` throw `NotImplementedError`), NOT on a constant READ —
// so mode-bit math (`mode & S_IFMT`), bitmasks, logging, `JSON.stringify` and feature-detection
// behave like Node. Single-source spread of the live sub-tables so the `node:fs` / `node:os` /
// `node:crypto` surfaces can never drift.
export const constants: Readonly<Record<string, NodeConstantValue>> = Object.freeze({
  ...fsConstants,
  ...osConstants.signals,
  ...osConstants.errno,
  ...osConstants.priority,
  ...osConstants.dlopen,
  UV_UDP_REUSEADDR: osConstants.UV_UDP_REUSEADDR,
  ...cryptoConstants,
} satisfies Record<string, NodeConstantValue>);

export default constants;
