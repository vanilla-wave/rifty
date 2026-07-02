import type { DevServerStatus, OwnerToPageFrame, PreviewPortEntry } from '../glue/pty-protocol.ts';

const DEV_SID = 'dev-server';
const PREVIEW_SID = 'preview';

export interface PreviewRegistryDeps {
  readonly send: (frame: OwnerToPageFrame) => void;
}
export interface AddNodeOpts {
  /** Owning terminal session — carried on the derived `pty:dev-server` frames. */
  readonly ptySid?: string;
  /** cwd of the command that started the server (reload-restore recording). */
  readonly cwd?: string;
  /** Display base for the switcher label (`<labelBase> :<port>`); default `node`. */
  readonly labelBase?: string;
}
export interface PreviewRegistry {
  setDevServer(port: number, previewScope?: string, ptySid?: string, cwd?: string): void;
  clearDevServer(): void;
  setPreview(port: number, previewScope?: string): void;
  clearPreview(): void;
  addNode(sid: string, ports: number[], previewScope?: string, opts?: AddNodeOpts): void;
  removeBySid(sid: string): void;
  /** Controller boot began — derived status reads 'starting' until a port lands. */
  devStarting(ptySid?: string): void;
  /** Controller run ended — clears the dev slot + the starting phase. */
  devStopped(): void;
  /** Controller boot failed — emits a stopped frame carrying `error`. */
  devBootFailed(message: string, ptySid?: string): void;
  /** Re-emit the current port set (answers pty:preview-req). */
  publish(): void;
  /** Re-emit the current derived dev-server frame (answers pty:dev-server-req). */
  publishDev(): void;
}

interface TrackedEntry {
  readonly entry: PreviewPortEntry;
  readonly ptySid?: string;
  readonly cwd?: string;
}

interface DerivedDev {
  readonly status: DevServerStatus;
  readonly sid?: string;
  readonly cwd?: string;
  readonly port?: number;
  readonly previewScope?: string;
}

/**
 * Live previewable ports (ADR-0155) + the SINGLE authority for `pty:dev-server`
 * frames: the page LIVE pill is DERIVED from the listening-port set — any guest
 * server (vite, webpack-dev-server, bare node:http) flips it, never a bin-name
 * check. The controller's
 * pre-listen phase rides `devStarting`/`devBootFailed`; a listening port wins.
 */
export function createPreviewRegistry(deps: PreviewRegistryDeps): PreviewRegistry {
  // Insertion order matters for the switcher default AND the derived pill's
  // primary port (most-senior server keeps the pill): dev server keeps its slot;
  // production preview follows; node/bin entries append.
  let dev: TrackedEntry | null = null;
  let preview: TrackedEntry | null = null;
  const node = new Map<string, TrackedEntry[]>();
  let starting: { readonly sid?: string } | null = null;
  let lastDev: DerivedDev = { status: 'stopped' };

  // Dedup by port so a `node server.js` that picks the SAME port as the live dev
  // server (no PORT injection, ADR-0155 §4) is not double-listed (ADR-0157 review
  // C3): the SW routes one `/preview/<port>/` per port, so two entries would make
  // the page wire two bridges on it and a teardown of either delete the shared
  // route. Dev slot wins (it was there first); first node sid wins among nodes.
  const snapshot = (): TrackedEntry[] => {
    const seen = new Set<number>();
    const out: TrackedEntry[] = [];
    for (const tracked of [
      ...(dev ? [dev] : []),
      ...(preview ? [preview] : []),
      ...[...node.values()].flat(),
    ]) {
      if (seen.has(tracked.entry.port)) continue;
      seen.add(tracked.entry.port);
      out.push(tracked);
    }
    return out;
  };

  const currentDev = (): DerivedDev => {
    const primary = snapshot()[0];
    if (primary) {
      return {
        status: 'running',
        ...(primary.ptySid === undefined ? {} : { sid: primary.ptySid }),
        ...(primary.cwd === undefined ? {} : { cwd: primary.cwd }),
        port: primary.entry.port,
        ...(primary.entry.previewScope === undefined
          ? {}
          : { previewScope: primary.entry.previewScope }),
      };
    }
    if (starting)
      return { status: 'starting', ...(starting.sid === undefined ? {} : { sid: starting.sid }) };
    // A stopped frame keeps the last owning sid so the page can correlate which
    // session's dev run ended (waitForDevServerBoot / boot-session bookkeeping).
    return { status: 'stopped', ...(lastDev.sid === undefined ? {} : { sid: lastDev.sid }) };
  };

  const devFrame = (d: DerivedDev, error?: string): OwnerToPageFrame => ({
    type: 'pty:dev-server',
    status: d.status,
    ...(d.sid === undefined ? {} : { sid: d.sid }),
    ...(d.cwd === undefined ? {} : { cwd: d.cwd }),
    ...(d.status === 'running' && d.port !== undefined
      ? { port: d.port, url: `/preview/${d.port}/` }
      : {}),
    ...(d.previewScope === undefined ? {} : { previewScope: d.previewScope }),
    ...(error === undefined ? {} : { error }),
  });

  const sameDev = (a: DerivedDev, b: DerivedDev): boolean =>
    a.status === b.status &&
    a.sid === b.sid &&
    a.cwd === b.cwd &&
    a.port === b.port &&
    a.previewScope === b.previewScope;

  const emitDev = (force = false): void => {
    const next = currentDev();
    if (!force && sameDev(next, lastDev)) return;
    lastDev = next;
    deps.send(devFrame(next));
  };

  const emit = (): void => {
    deps.send({ type: 'pty:preview', ports: snapshot().map((t) => t.entry) });
    emitDev();
  };

  return {
    setDevServer(port, previewScope, ptySid, cwd) {
      dev = {
        entry: {
          port,
          url: `/preview/${port}/`,
          label: 'npm run dev',
          source: 'dev-server',
          sid: DEV_SID,
          ...(previewScope === undefined ? {} : { previewScope }),
        },
        ...(ptySid === undefined ? {} : { ptySid }),
        ...(cwd === undefined ? {} : { cwd }),
      };
      emit();
    },
    clearDevServer() {
      dev = null;
      emit();
    },
    setPreview(port, previewScope) {
      preview = {
        entry: {
          port,
          url: `/preview/${port}/`,
          label: 'vite preview',
          source: 'preview',
          sid: PREVIEW_SID,
          ...(previewScope === undefined ? {} : { previewScope }),
        },
      };
      emit();
    },
    clearPreview() {
      preview = null;
      emit();
    },
    addNode(sid, ports, previewScope, opts) {
      const labelBase = opts?.labelBase ?? 'node';
      node.set(
        sid,
        ports.map((port) => ({
          entry: {
            port,
            url: `/preview/${port}/`,
            label: `${labelBase} :${port}`,
            source: 'node' as const,
            sid,
            ...(previewScope === undefined ? {} : { previewScope }),
          },
          ...(opts?.ptySid === undefined ? {} : { ptySid: opts.ptySid }),
          ...(opts?.cwd === undefined ? {} : { cwd: opts.cwd }),
        })),
      );
      emit();
    },
    removeBySid(sid) {
      if (node.delete(sid)) emit();
    },
    devStarting(ptySid) {
      starting = { ...(ptySid === undefined ? {} : { sid: ptySid }) };
      emitDev();
    },
    devStopped() {
      starting = null;
      dev = null;
      emit();
    },
    devBootFailed(message, ptySid) {
      starting = null;
      const next = currentDev();
      // Status stays DERIVED: with another server live, forcing a global
      // 'stopped' would flip the pill off while its port still serves. The
      // failed boot's error rides the frame either way.
      if (next.status === 'stopped') {
        const stopped: DerivedDev = {
          status: 'stopped',
          ...(ptySid === undefined ? {} : { sid: ptySid }),
        };
        lastDev = stopped;
        deps.send(devFrame(stopped, message));
        return;
      }
      lastDev = next;
      deps.send(devFrame(next, message));
    },
    publish() {
      deps.send({ type: 'pty:preview', ports: snapshot().map((t) => t.entry) });
    },
    publishDev() {
      emitDev(true);
    },
  };
}
