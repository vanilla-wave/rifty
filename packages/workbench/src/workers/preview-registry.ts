import type {
  DevServerStatus,
  OwnerPtyRunAdmission,
  OwnerToPageFrame,
  PreviewPortEntry,
} from '../glue/pty-protocol.ts';

const DEV_SID = 'dev-server';
const PREVIEW_SID = 'preview';

export interface PreviewRegistryDeps {
  readonly send: (frame: OwnerToPageFrame) => void;
}
export type PreviewProducerOrigin =
  | { readonly kind: 'pty'; readonly admission: OwnerPtyRunAdmission }
  | { readonly kind: 'host' };
export const HOST_PREVIEW_ORIGIN: PreviewProducerOrigin = Object.freeze({ kind: 'host' });

export interface AddNodeOpts {
  /** Explicit host source or actor-minted PTY identity captured at child launch. */
  readonly origin: PreviewProducerOrigin;
  /** cwd of the command that started the server (reload-restore recording). */
  readonly cwd?: string;
  /** Display base for the switcher label (`<labelBase> :<port>`); default `node`. */
  readonly labelBase?: string;
}
export interface SetDevServerOpts {
  /** Explicit host source or actor-minted PTY identity captured at child launch. */
  readonly origin: PreviewProducerOrigin;
  /** cwd of the command that started the server (reload-restore recording). */
  readonly cwd?: string;
}
export interface PreviewRegistry {
  setDevServer(port: number, previewScope: string | undefined, opts: SetDevServerOpts): void;
  clearDevServer(): void;
  setPreview(port: number, previewScope: string | undefined, origin: PreviewProducerOrigin): void;
  clearPreview(): void;
  addNode(sid: string, ports: number[], previewScope: string | undefined, opts: AddNodeOpts): void;
  removeBySid(sid: string): void;
  /** Controller boot began — derived status reads 'starting' until a port lands. */
  devStarting(origin: PreviewProducerOrigin): void;
  /** Controller run ended — clears the dev slot + the starting phase. */
  devStopped(): void;
  /** Controller boot or running child failed — removes its slot and carries `error`. */
  devBootFailed(message: string, origin: PreviewProducerOrigin): void;
  /** Re-emit the current port set (answers pty:preview-req). */
  publish(): void;
  /** Re-emit the current derived dev-server frame (answers pty:dev-server-req). */
  publishDev(): void;
  /** Fence producers and publish the definitive empty owner snapshot. */
  close(): void;
}

interface TrackedEntry {
  readonly entry: PreviewPortEntry;
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
  const previewIdentity = (origin: PreviewProducerOrigin) =>
    origin.kind === 'pty'
      ? {
          ptySid: origin.admission.ptySid,
          ptyRid: origin.admission.ptyRid,
        }
      : {};

  // Insertion order matters for the switcher default AND the derived pill's
  // primary port (most-senior server keeps the pill): dev server keeps its slot;
  // production preview follows; node/bin entries append.
  let dev: TrackedEntry | null = null;
  let preview: TrackedEntry | null = null;
  const node = new Map<string, TrackedEntry[]>();
  let starting: { readonly sid?: string } | null = null;
  let lastDev: DerivedDev = { status: 'stopped' };
  let closed = false;

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
        ...(primary.entry.ptySid === undefined ? {} : { sid: primary.entry.ptySid }),
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
    setDevServer(port, previewScope, opts) {
      if (closed) return;
      dev = {
        entry: {
          port,
          url: `/preview/${port}/`,
          label: 'npm run dev',
          source: 'dev-server',
          sid: DEV_SID,
          ...previewIdentity(opts.origin),
          ...(previewScope === undefined ? {} : { previewScope }),
        },
        ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      };
      emit();
    },
    clearDevServer() {
      if (closed) return;
      dev = null;
      emit();
    },
    setPreview(port, previewScope, origin) {
      if (closed) return;
      preview = {
        entry: {
          port,
          url: `/preview/${port}/`,
          label: 'vite preview',
          source: 'preview',
          sid: PREVIEW_SID,
          ...previewIdentity(origin),
          ...(previewScope === undefined ? {} : { previewScope }),
        },
      };
      emit();
    },
    clearPreview() {
      if (closed) return;
      preview = null;
      emit();
    },
    addNode(sid, ports, previewScope, opts) {
      if (closed) return;
      const labelBase = opts.labelBase ?? 'node';
      node.set(
        sid,
        ports.map((port) => ({
          entry: {
            port,
            url: `/preview/${port}/`,
            label: `${labelBase} :${port}`,
            source: 'node' as const,
            sid,
            ...previewIdentity(opts.origin),
            ...(previewScope === undefined ? {} : { previewScope }),
          },
          ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
        })),
      );
      emit();
    },
    removeBySid(sid) {
      if (closed) return;
      if (node.delete(sid)) emit();
    },
    devStarting(origin) {
      if (closed) return;
      starting = {
        ...(origin.kind === 'pty' ? { sid: origin.admission.ptySid } : {}),
      };
      emitDev();
    },
    devStopped() {
      if (closed) return;
      starting = null;
      dev = null;
      emit();
    },
    devBootFailed(message, origin) {
      if (closed) return;
      starting = null;
      dev = null;
      deps.send({ type: 'pty:preview', ports: snapshot().map((t) => t.entry) });
      const next = currentDev();
      // Status stays DERIVED: with another server live, forcing a global
      // 'stopped' would flip the pill off while its port still serves. The
      // failed boot's error rides the frame either way.
      if (next.status === 'stopped') {
        const stopped: DerivedDev = {
          status: 'stopped',
          ...(origin.kind === 'pty' ? { sid: origin.admission.ptySid } : {}),
        };
        lastDev = stopped;
        deps.send(devFrame(stopped, message));
        return;
      }
      lastDev = next;
      deps.send(devFrame(next, message));
    },
    publish() {
      if (closed) return;
      deps.send({ type: 'pty:preview', ports: snapshot().map((t) => t.entry) });
    },
    publishDev() {
      if (closed) return;
      emitDev(true);
    },
    close() {
      if (closed) return;
      closed = true;
      dev = null;
      preview = null;
      node.clear();
      starting = null;
      lastDev = { status: 'stopped' };
      deps.send({ type: 'pty:preview', ports: [] });
      deps.send(devFrame(lastDev));
    },
  };
}
