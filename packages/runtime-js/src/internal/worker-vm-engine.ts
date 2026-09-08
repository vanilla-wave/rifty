import type { VmEngineName } from '../protocol.ts';

const QUICKJS_NAME = 'rifty-vm-engine=quickjs';
const REWRITE_NAME = 'rifty-vm-engine=rewrite';

/** Native construction metadata, available even before a Blob entry imports runtime. */
export function vmEngineWorkerName(engine: VmEngineName | undefined): string | undefined {
  if (engine === undefined) return undefined;
  if (engine === 'quickjs') return QUICKJS_NAME;
  if (engine === 'rewrite') return REWRITE_NAME;
  throw new TypeError(`Unsupported vmEngine: ${String(engine)}`);
}

export function vmEngineFromWorkerName(name: string): VmEngineName | undefined {
  if (name === QUICKJS_NAME) return 'quickjs';
  if (name === REWRITE_NAME) return 'rewrite';
  return undefined;
}
