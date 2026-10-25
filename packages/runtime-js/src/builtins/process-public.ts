import { readActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';
import { NodeProcess, riftyProcess } from './process.ts';

/** The realm's `node:process`: the active bootstrap, a live NodeProcess global, else the default. */
export function publicNodeProcess(): object {
  const active = readActiveNodeProcessBootstrap()?.process;
  if (active !== undefined) return active;
  const live = (globalThis as { process?: unknown }).process;
  return live instanceof NodeProcess ? live : riftyProcess;
}
