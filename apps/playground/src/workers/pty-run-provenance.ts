import type { PtyRunOrigin } from '../glue/pty-protocol.ts';
import type { WorkspaceMutationIntent } from '../glue/scoped-vfs.ts';

export interface PtyRunProvenance {
  readonly sid: string;
  readonly rid: string;
  readonly origin: PtyRunOrigin;
}

export interface PtyRunProvenanceLedger {
  start(run: PtyRunProvenance): void;
  settle(run: PtyRunProvenance): void;
  intentForSession(sid: string | undefined): WorkspaceMutationIntent;
}

/** Baseline only when every live run in the terminal session is trusted boot work. */
export function createPtyRunProvenanceLedger(): PtyRunProvenanceLedger {
  const active = new Map<string, Map<string, PtyRunOrigin>>();

  return {
    start(run): void {
      const runs = active.get(run.sid) ?? new Map<string, PtyRunOrigin>();
      runs.set(run.rid, run.origin);
      active.set(run.sid, runs);
    },
    settle(run): void {
      const runs = active.get(run.sid);
      if (!runs || runs.get(run.rid) !== run.origin) return;
      runs.delete(run.rid);
      if (runs.size === 0) active.delete(run.sid);
    },
    intentForSession(sid): WorkspaceMutationIntent {
      if (sid === undefined) return 'protect';
      const runs = active.get(sid);
      if (!runs || runs.size === 0) return 'protect';
      return [...runs.values()].every((origin) => origin === 'boot') ? 'baseline' : 'protect';
    },
  };
}
