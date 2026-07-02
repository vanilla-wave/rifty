/**
 * Dev-server lifecycle orchestration — headless core extracted from App.tsx
 * (ADR-0195, epic playground-testable-core). Owns the page mirror of the
 * owner-driven dev-server state (ADR-0148 co-resident dev server): LIVE status,
 * the preview-port set + per-port SW bridges (ADR-0155/0157), dev-session
 * bookkeeping, boot/stop/restart sequencing and their wait loops.
 *
 * No UI imports (xterm/monaco/components/adapters — dep-cruiser rule
 * `no-ui-imports-in-playground-orchestration`); every side effect goes through
 * the injected ports below, which are also the behavioral-test seam.
 */
import { createSignal } from 'solid-js';
import type { PreviewPortEntry, PtyDevServer, PtyPreview } from '../glue/pty-protocol.ts';
import type { Preset } from '../presets.ts';
import type { ProjectSpec } from '../templates/project-spec.ts';

/** Minimal session shape the lifecycle needs (structural subset of the
 *  terminal-manager snapshot — the manager stays UI-side). */
export interface DevServerSessionLike {
  readonly id: string;
  readonly status: 'idle' | 'running';
}

/** Owner surface the lifecycle consumes (subset of WorkspaceOwnerHandle). */
export interface DevServerOwnerPort {
  onDevServer(cb: (frame: PtyDevServer) => void): () => void;
  onPreview(cb: (frame: PtyPreview) => void): () => void;
  requestPreview(): void;
  readonly previewOwnerToken: string;
}

/** Page-terminal surface the lifecycle consumes (manager + visibility state). */
export interface DevServerTerminalPort<S extends DevServerSessionLike> {
  /** Throws on an unknown/closed session id (manager.snapshot semantics). */
  snapshot(id: string): S;
  activeSessionId(): string;
  select(id: string): void;
  stop(id: string): void;
  freshConsole(id: string, banner?: string): void;
  createSession(): S;
  refreshState(): void;
  visibleSessions(): S[];
  isHidden(id: string): boolean;
}

export interface DevServerCommand {
  readonly line: string;
  readonly cwd: string;
}

export interface DevServerLifecycleDeps<S extends DevServerSessionLike> {
  terminal: DevServerTerminalPort<S>;
  /** Fire-and-forget boot sequence in the owner shell (page echoes `$ <line>`). */
  runBootSequence(sessionId: string, lines: readonly string[]): Promise<void>;
  /** Last EXECUTED line per session (exec funnel) — the dev command that started the server. */
  executedLine(sessionId: string): DevServerCommand | undefined;
  /** Persist (or clear, with `undefined`) the dev command for reload-restore. */
  persistDevCommand(command: DevServerCommand | undefined): void;
  setRealVitePort(port: number): void;
  /** A non-stopped frame proves the owner is alive (workspaceOwnerReady gate). */
  onOwnerAlive(): void;
  /** stopped→running edge — TS project revision bump lives with the TS slice. */
  onServerRunningEdge(): void;
  /** SW preview-route wiring; returns the teardown. */
  wirePreviewBridge(port: number, ownerToken: string, previewScope?: string): () => void;
  /** Boot lines for a preset at the ACTIVE root. */
  bootLines(preset: Preset): readonly string[];
  /** The active STARTER's preset (store-derived, ADR-0165 §4) — restart boots THIS. */
  activeStarterPreset(): Preset;
  templateForPreset(preset: Preset): ProjectSpec;
  welcomeBanner?: string;
}

export interface DevServerLifecycle<S extends DevServerSessionLike> {
  /**
   * (Re)bind the owner: drop the previous owner's subscriptions, mirror the new
   * owner's dev-server + preview frames, re-request the preview set (handshake
   * discipline — never a one-shot push) and reconcile the SW bridges under the
   * new owner. App calls this from a one-line `createEffect` on the owner
   * signal; explicit (not an internal effect) because the node test runtime is
   * solid-server, where `createEffect` never runs (ADR-0195 §4).
   */
  attachOwner(owner: DevServerOwnerPort): void;
  /** Unsubscribe from the owner and tear every live preview bridge. */
  dispose(): void;
  status(): 'stopped' | 'starting' | 'running';
  running(): boolean;
  previewPorts(): PreviewPortEntry[];
  /** The page session the dev command was (last) dispatched in. */
  sessionId(): string | null;
  /** Owner-reported (or booting) session a palette "Stop dev server" targets. */
  stoppableSessionId(): string | null;
  /** True while OUR tracked session runs the lifecycle dev command. */
  lifecycleRunning(): boolean;
  /** Force the mirror to 'stopped' (owner respawn re-derives truth — switch path). */
  markStopped(): void;
  claimSession(id: string): void;
  beginBoot(id: string): void;
  nextGeneration(): number;
  currentGeneration(): number;
  /** Pick/reuse an idle visible terminal for the dev command (selects it). */
  pickSession(): S;
  reserveSession(session: S): Promise<S>;
  startSession(
    sessionId: string,
    generation: number,
    preset: Preset,
    bootLinesOverride?: readonly string[],
  ): Promise<boolean>;
  stopSession(sessionId: string | null): Promise<void>;
  stopBeforeStarterWrite(): Promise<void>;
  restart(sessionId: string): Promise<void>;
  waitForPresetBoot(sessionId: string, generation: number, spec: ProjectSpec): Promise<boolean>;
  waitForTerminalIdle(sessionId: string | null): Promise<void>;
}

const POLL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createDevServerLifecycle<S extends DevServerSessionLike>(
  deps: DevServerLifecycleDeps<S>,
): DevServerLifecycle<S> {
  const { terminal } = deps;
  const [devServerStatus, setDevServerStatus] = createSignal<'stopped' | 'starting' | 'running'>(
    'stopped',
  );
  // ALL live previewable ports (ADR-0155): the dev-server port + each `node
  // <file>` server's ports, pushed by the owner as a `pty:preview` snapshot.
  const [previewPorts, setPreviewPorts] = createSignal<PreviewPortEntry[]>([]);
  let devServerSessionId: string | null = null;
  let devServerBootSessionId: string | null = null;
  let devServerOwnerSessionId: string | null = null;
  let devServerRestartGeneration = 0;

  let currentOwner: DevServerOwnerPort | null = null;
  let unsubscribeDevServer: (() => void) | null = null;
  let unsubscribePreview: (() => void) | null = null;

  // Mirror the owner's dev-server state (ADR-0148). The frames are DERIVED from
  // the owner's listening-port set — the pill/status here, but the SW bridge
  // wiring lives SOLELY on the `pty:preview` set path below: every
  // derived-running port is also a set entry, so wiring here too would
  // transiently double-bridge the same `/preview/<port>/` route (the C3 clobber).
  function onDevServerFrame(frame: PtyDevServer): void {
    const wasRunning = devServerStatus() === 'running';
    if (frame.status === 'stopped') {
      devServerOwnerSessionId = null;
      if (frame.sid === undefined || frame.sid === devServerBootSessionId) {
        devServerBootSessionId = null;
      }
    } else {
      devServerOwnerSessionId = frame.sid ?? null;
    }
    setDevServerStatus(frame.status);
    if (frame.status !== 'stopped') deps.onOwnerAlive();
    if (frame.status === 'running' && !wasRunning) deps.onServerRunningEdge();
    // Record/clear the dev command for reload-restore: 'running' pins the line
    // that started this server; a REAL running→stopped without error (Ctrl-C /
    // server.close) clears it. An errored stop (owner crash/exit) keeps it — a
    // reload should relaunch; nor does a boot-time 'stopped' re-publish clear.
    if (frame.status === 'running' && frame.sid !== undefined) {
      const executed = deps.executedLine(frame.sid);
      // cwd: prefer the OWNER-reported command cwd — the page session cache
      // reflects the last pty:exit ('/' before any), not the running command.
      if (executed) {
        deps.persistDevCommand({ line: executed.line, cwd: frame.cwd ?? executed.cwd });
      }
    } else if (frame.status === 'stopped' && frame.error === undefined && wasRunning) {
      deps.persistDevCommand(undefined);
    }
    if (frame.port !== undefined) deps.setRealVitePort(frame.port);
  }

  // Per-port SW preview bridge — the ONE wiring path for EVERY previewable port
  // (dev server, `vite preview`, node/bin servers alike): the `pty:preview` set
  // is the single source, so no port can ever be double-bridged (ADR-0157 review
  // C3 — a second clobbering bridge's teardown deletes the shared route; the set
  // itself dedups by port). Diff the live port+scope bridges against active
  // teardowns: wire a newly-present port, tear a departed one.
  function previewBridgeKey(port: number, previewScope?: string): string {
    return JSON.stringify([port, previewScope ?? null]);
  }
  const nodePortBridges = new Map<string, () => void>();
  function reconcileBridges(): void {
    const owner = currentOwner;
    if (!owner) return;
    const entries = previewPorts();
    const live = new Set(entries.map((p) => previewBridgeKey(p.port, p.previewScope)));
    for (const [key, tear] of nodePortBridges) {
      if (!live.has(key)) {
        tear();
        nodePortBridges.delete(key);
      }
    }
    for (const p of entries) {
      const key = previewBridgeKey(p.port, p.previewScope);
      if (!nodePortBridges.has(key)) {
        nodePortBridges.set(
          key,
          deps.wirePreviewBridge(p.port, owner.previewOwnerToken, p.previewScope),
        );
      }
    }
  }

  function attachOwner(owner: DevServerOwnerPort): void {
    unsubscribeDevServer?.();
    unsubscribePreview?.();
    currentOwner = owner;
    unsubscribeDevServer = owner.onDevServer(onDevServerFrame);
    // Mirror the owner's full preview-port set (ADR-0155) + (re)request it on
    // subscribe — recovers a `pty:preview` push that predates this listener (same
    // handshake discipline as the dev-server-req; never a one-shot push).
    unsubscribePreview = owner.onPreview((frame) => {
      setPreviewPorts(frame.ports);
      reconcileBridges();
    });
    owner.requestPreview();
    reconcileBridges();
  }

  function dispose(): void {
    unsubscribeDevServer?.();
    unsubscribePreview?.();
    unsubscribeDevServer = null;
    unsubscribePreview = null;
    currentOwner = null;
    for (const tear of nodePortBridges.values()) tear();
    nodePortBridges.clear();
  }

  function pickSession(): S {
    if (devServerSessionId) {
      const previous = terminal.snapshot(devServerSessionId);
      if (previous.status === 'idle' && !terminal.isHidden(previous.id)) {
        terminal.select(previous.id);
        terminal.refreshState();
        return previous;
      }
    }
    const active = terminal.snapshot(terminal.activeSessionId());
    if (active.status === 'idle') return active;
    const idle = terminal.visibleSessions().find((session) => session.status === 'idle');
    if (idle) {
      terminal.select(idle.id);
      terminal.refreshState();
      return idle;
    }
    return terminal.createSession();
  }

  function usableDevServerSession(id: string): S | undefined {
    try {
      const session = terminal.snapshot(id);
      return session.status === 'idle' && !terminal.isHidden(session.id) ? session : undefined;
    } catch {
      return undefined;
    }
  }

  async function reserveSession(session: S): Promise<S> {
    const reserved = usableDevServerSession(session.id);
    if (reserved) return reserved;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replacement = terminal.createSession();
      await sleep(0);
      const usable = usableDevServerSession(replacement.id);
      if (usable) return usable;
    }
    throw new Error('Unable to reserve an idle terminal for the dev server');
  }

  function isVisibleTerminalSession(id: string): boolean {
    try {
      terminal.snapshot(id);
      return !terminal.isHidden(id);
    } catch {
      return false;
    }
  }

  async function waitForDevServerStop(sessionId: string): Promise<void> {
    // The derived status is GLOBAL (any listening server keeps it 'running' —
    // generic lifecycle): with a second server (node/bin) live, waiting for a
    // global 'stopped' after stopping ONE session spins forever. Wait until
    // OUR session stops owning the primary: everything stopped, or the pill
    // moved to another session's server.
    while (devServerStatus() !== 'stopped' && devServerOwnerSessionId === sessionId) {
      await sleep(POLL_MS);
    }
  }

  function terminalStatus(id: string | null): 'idle' | 'running' | undefined {
    if (!id) return undefined;
    try {
      return terminal.snapshot(id).status;
    } catch {
      return undefined;
    }
  }

  function clearDevServerBootSession(sessionId: string): void {
    if (devServerBootSessionId === sessionId) devServerBootSessionId = null;
  }

  function lifecycleSessionRunning(sessionId: string | null): boolean {
    return (
      sessionId !== null &&
      devServerBootSessionId === sessionId &&
      (terminalStatus(sessionId) === 'running' || devServerOwnerSessionId === sessionId)
    );
  }

  function lifecycleDevServerRunning(): boolean {
    return lifecycleSessionRunning(devServerSessionId);
  }

  async function waitForTerminalIdle(id: string | null): Promise<void> {
    while (terminalStatus(id) === 'running') {
      await sleep(POLL_MS);
    }
  }

  async function waitForDevServerBoot(sessionId: string, generation: number): Promise<boolean> {
    while (generation === devServerRestartGeneration) {
      if (devServerStatus() === 'running' && devServerOwnerSessionId === sessionId) return true;
      if (terminalStatus(sessionId) === 'idle') {
        clearDevServerBootSession(sessionId);
        return false;
      }
      await sleep(POLL_MS);
    }
    clearDevServerBootSession(sessionId);
    return false;
  }

  async function waitForPresetBoot(
    sessionId: string,
    generation: number,
    spec: ProjectSpec,
  ): Promise<boolean> {
    if (spec.runtime === 'node-cli') {
      await waitForTerminalIdle(sessionId);
      clearDevServerBootSession(sessionId);
      return true;
    }
    return waitForDevServerBoot(sessionId, generation);
  }

  async function stopSession(sessionId: string | null): Promise<void> {
    const stopLifecycleRun = lifecycleSessionRunning(sessionId);
    if (sessionId && stopLifecycleRun) terminal.stop(sessionId);
    if (sessionId && stopLifecycleRun && devServerOwnerSessionId === sessionId) {
      await waitForDevServerStop(sessionId);
    }
    if (stopLifecycleRun) {
      await waitForTerminalIdle(sessionId);
      if (sessionId) clearDevServerBootSession(sessionId);
      // No local setPreviewPorts([]): the set is OWNER-derived (pty:preview) —
      // a local wipe would tear a second live server's preview bridge; the
      // owner's devStopped emit delivers the truthful remainder.
    }
  }

  async function stopBeforeStarterWrite(): Promise<void> {
    const sessionId = lifecycleDevServerRunning() ? (devServerSessionId ?? pickSession().id) : null;
    await stopSession(sessionId);
  }

  async function startSession(
    sessionId: string,
    generation: number,
    preset: Preset,
    bootLinesOverride?: readonly string[],
  ): Promise<boolean> {
    const targetSessionId = isVisibleTerminalSession(sessionId) ? sessionId : pickSession().id;
    devServerSessionId = targetSessionId;
    devServerBootSessionId = targetSessionId;
    terminal.freshConsole(targetSessionId, deps.welcomeBanner); // fresh console + greeting
    void deps.runBootSequence(targetSessionId, bootLinesOverride ?? deps.bootLines(preset));
    return waitForPresetBoot(targetSessionId, generation, deps.templateForPreset(preset));
  }

  async function restart(sessionId: string): Promise<void> {
    const generation = ++devServerRestartGeneration;
    // Stop the running dev command in its session (ADR-0148): the owner aborts
    // the run → the co-resident dev server stops → status → 'stopped'.
    await stopSession(devServerSessionId);
    if (generation !== devServerRestartGeneration) return;
    // Boot lines follow the ACTIVE STARTER (store-derived, ADR-0165 §4): on a
    // switch the store has re-pointed to the destination project's starter, so a
    // restart boots ITS template — never the stale picked-preset starter.
    await startSession(sessionId, generation, deps.activeStarterPreset());
  }

  return {
    attachOwner,
    dispose,
    status: devServerStatus,
    running: () => devServerStatus() === 'running',
    previewPorts,
    sessionId: () => devServerSessionId,
    stoppableSessionId: () => devServerOwnerSessionId ?? devServerBootSessionId,
    lifecycleRunning: lifecycleDevServerRunning,
    markStopped: () => setDevServerStatus('stopped'),
    claimSession: (id) => {
      devServerSessionId = id;
    },
    beginBoot: (id) => {
      devServerBootSessionId = id;
    },
    nextGeneration: () => ++devServerRestartGeneration,
    currentGeneration: () => devServerRestartGeneration,
    pickSession,
    reserveSession,
    startSession,
    stopSession,
    stopBeforeStarterWrite,
    restart,
    waitForPresetBoot,
    waitForTerminalIdle,
  };
}
