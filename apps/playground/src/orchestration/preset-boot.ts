/**
 * Preset-boot orchestration — headless core extracted from App.tsx (ADR-0197,
 * epic playground-testable-core, slice 3). Owns the preset-transition veil +
 * serialization queue, the TS-request gate over an in-flight transition, the
 * dev-server preset boot (fresh session vs restart-in-place, ADR-0148) and the
 * gallery-pick flow (paint → owner start → stop-before-write → scratch
 * establish → scratch-owner reconciliation → memory-mode seed → boot).
 *
 * No UI imports; every side effect goes through the injected ports below —
 * the behavioral-test seam (ADR-0197 §4). The dev-server core (slice 1) is
 * injected as a port (dependency spine).
 */
import { createSignal } from 'solid-js';
import type { Preset } from '../presets.ts';
import type { ProjectSpec } from '../templates/project-spec.ts';

export interface TsPresetTransitionGate {
  resolve(): void;
}

/** Session shape the boot needs (structural subset of the terminal snapshot). */
export interface PresetBootSessionLike {
  readonly id: string;
}

export interface PresetBootDeps<S extends PresetBootSessionLike> {
  /** Earlier-slice dev-server core injected as a port (ADR-0197 spine). */
  devServer: {
    lifecycleRunning(): boolean;
    sessionId(): string | null;
    pickSession(): S;
    reserveSession(session: S): Promise<S>;
    claimSession(id: string): void;
    beginBoot(id: string): void;
    nextGeneration(): number;
    currentGeneration(): number;
    stopSession(sessionId: string | null): Promise<void>;
    stopBeforeStarterWrite(): Promise<void>;
    startSession(
      sessionId: string,
      generation: number,
      preset: Preset,
      bootLinesOverride?: readonly string[],
    ): Promise<boolean>;
    waitForPresetBoot(sessionId: string, generation: number, spec: ProjectSpec): Promise<boolean>;
  };
  presetForId(id: string): Preset;
  templateForPreset(preset: Preset): ProjectSpec;
  /** Boot lines for a preset at the ACTIVE root. */
  bootLines(preset: Preset): readonly string[];
  /**
   * Owner dev-config assignment (ADR-0148): template/runtime/slug for the next
   * co-resident dev-server run. Ack is config-assignment only — the deps restore
   * no longer gates it, so the `$ <boot line>` echo paints immediately.
   */
  applyDevConfig(preset: Preset): Promise<void>;
  /** Fresh console + greeting in the boot session. */
  freshConsole(sessionId: string): void;
  /** Fire-and-forget boot sequence in the owner shell (page echoes `$ <line>`). */
  runBootSequence(sessionId: string, lines: readonly string[]): Promise<void>;
  /** TS re-init after a picked-preset boot (starter files changed under the root). */
  reinitializeTs(): void;
  // ── gallery-pick flow ports ──
  /** Is the pick landing on a DIRTY scratch (store prompts via the switch dialog)? */
  dirtyScratchPick(): boolean;
  setOwnerReady(ready: boolean): void;
  /** Paint the picked starter's UI (mode machine, snapshot, initial tabs). */
  paintStarterUi(preset: Preset): Promise<void>;
  /** Optimistic editor mount — the owner index publish lags the pick. */
  markEditorContextReady(): void;
  /** Intent-gated warm of the lazy editor stack before EditorHost mount. */
  warmEditorStack(): void;
  /** Flag the next owner spawn as starter-baseline-pending when not yet started. */
  noteStarterBaselinePending(): void;
  ensureOwnerStarted(): Promise<unknown>;
  /** (Re)create the durable scratch entry + re-seed /scratch (no-op in memory mode). */
  establishScratch(id: string, opts: { preserveDirtySameStarter?: boolean }): Promise<void>;
  /** Respawn an owner frozen to another project root; resolves only at /scratch. */
  ensureScratchOwnerRoot(): Promise<void>;
  /** Await a fresh /scratch snapshot, then reopen starter tabs from owner bytes. */
  refreshStarterEditorContext(): Promise<void>;
  /** Memory mode has no durable index → the pick seeds the owner tree itself. */
  readonly ephemeralStorage: boolean;
  seedWorkspace(preset: Preset): Promise<void>;
}

export interface PickStarterOpts {
  /** Commit the pick in the store (guarded `pickStarter` vs unguarded `confirmPickStarter`). */
  commit(id: string): void;
  /** Gate on a dirty scratch: commit opens the switch dialog and the boot aborts. */
  guardDirtyScratch: boolean;
  preserveDirtySameStarter?: boolean;
  /**
   * Open the TS gate BEFORE queueing (the confirmed switch-dialog pick gates TS
   * requests for the whole queued wait; a plain gallery pick gates from dequeue).
   */
  eagerTsGate?: boolean;
}

export interface PresetBoot {
  /** True while a preset boot/switch transition is in flight (loader veil). */
  transitioning(): boolean;
  /** Veil hooks for the workspace-switch path (workspace-lifecycle binds them). */
  beginTransition(): void;
  endTransition(): void;
  /** Resolves when no TS-blocking preset transition is in flight. */
  tsTransitionReady(): Promise<void>;
  beginTsTransition(): TsPresetTransitionGate;
  /** Serialize a launch through the one preset-transition queue. */
  queueTransition(run: () => Promise<void>): Promise<void>;
  /**
   * Boot a preset's dev server: restart the lifecycle-owned session in place
   * when one runs, else pick/reserve a fresh terminal and boot there. Resolves
   * after the boot settles (or the restart generation was superseded).
   */
  runPreset(
    preset: Preset,
    tsGate?: TsPresetTransitionGate,
    bootLinesOverride?: readonly string[],
  ): Promise<void>;
  /**
   * Gallery-pick flow, serialized through the transition queue. Resolves only
   * after the owner transition + preset boot reaches a terminal outcome.
   */
  pickStarter(id: string, opts: PickStarterOpts): Promise<void>;
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createPresetBoot<S extends PresetBootSessionLike>(
  deps: PresetBootDeps<S>,
): PresetBoot {
  const [transitioning, setTransitioning] = createSignal(false);
  let transitionChain: Promise<void> = Promise.resolve();
  let tsReady: Promise<void> = Promise.resolve();

  function beginTsTransition(): TsPresetTransitionGate {
    let resolve!: () => void;
    tsReady = new Promise<void>((done) => {
      resolve = done;
    });
    return { resolve };
  }

  function queueTransition(run: () => Promise<void>): Promise<void> {
    const queued = transitionChain.then(run, run);
    transitionChain = queued.catch((err: unknown) => {
      console.error('[preset-transition] failed', err);
    });
    return transitionChain;
  }

  async function runPreset(
    preset: Preset,
    tsGate?: TsPresetTransitionGate,
    bootLinesOverride?: readonly string[],
  ): Promise<void> {
    try {
      setTransitioning(true);
      // The caller already painted the starter UI and established the owner tree
      // (establishScratch/seedWorkspace). Re-seeding here can erase edits made
      // during the boot window.
      const restartNeeded = deps.devServer.lifecycleRunning();
      const restartSessionId = restartNeeded
        ? (deps.devServer.sessionId() ?? deps.devServer.pickSession().id)
        : undefined;
      const restartGeneration = restartNeeded ? deps.devServer.nextGeneration() : undefined;
      if (restartNeeded) await deps.devServer.stopSession(restartSessionId ?? null);
      if (
        restartGeneration !== undefined &&
        restartGeneration !== deps.devServer.currentGeneration()
      ) {
        return;
      }
      let session: S | undefined;
      if (!restartNeeded) {
        session = deps.devServer.pickSession();
        deps.devServer.claimSession(session.id);
      }
      await deps.applyDevConfig(preset);
      if (restartNeeded) {
        if (restartSessionId && restartGeneration !== undefined) {
          const booted = await deps.devServer.startSession(
            restartSessionId,
            restartGeneration,
            preset,
            bootLinesOverride,
          );
          if (!booted) return;
        }
        deps.reinitializeTs();
        return;
      }
      if (!session) return;
      session = await deps.devServer.reserveSession(session);
      deps.devServer.claimSession(session.id);
      deps.freshConsole(session.id); // fresh console + greeting
      const generation = deps.devServer.nextGeneration();
      deps.devServer.beginBoot(session.id);
      void deps.runBootSequence(session.id, bootLinesOverride ?? deps.bootLines(preset));
      const booted = await deps.devServer.waitForPresetBoot(
        session.id,
        generation,
        deps.templateForPreset(preset),
      );
      if (!booted) return;
      deps.reinitializeTs();
    } finally {
      setTransitioning(false);
      tsGate?.resolve();
    }
  }

  async function bootPickedStarter(
    id: string,
    eagerGate: TsPresetTransitionGate | undefined,
    opts: PickStarterOpts,
  ): Promise<void> {
    const wasDirty = opts.guardDirtyScratch ? deps.dirtyScratchPick() : false;
    const tsGate = wasDirty ? undefined : (eagerGate ?? beginTsTransition());
    let gateOwnedByRunPreset = false;
    try {
      if (!wasDirty) deps.setOwnerReady(false);
      opts.commit(id); // dirty pick: the store opened the switch dialog — abort here
      if (wasDirty) return;
      const preset = deps.presetForId(id);
      await deps.paintStarterUi(preset);
      deps.markEditorContextReady();
      deps.noteStarterBaselinePending();
      await deps.ensureOwnerStarted();
      // Stop a running dev server BEFORE the starter files land on the owner tree.
      await deps.devServer.stopBeforeStarterWrite();
      await deps.establishScratch(id, { preserveDirtySameStarter: opts.preserveDirtySameStarter });
      // Owner roots are spawn-time immutable. A pick from a named project must
      // respawn at the newly-established scratch before snapshots or boot resume.
      await deps.ensureScratchOwnerRoot();
      // Memory mode: establishScratch is a no-op (no durable index), so this seed is
      // the ONLY owner-tree seed — AWAIT it before runPreset boots vite, else the
      // dev server can start over an un-seeded /scratch.
      if (deps.ephemeralStorage) await deps.seedWorkspace(preset);
      await deps.refreshStarterEditorContext();
      deps.setOwnerReady(true);
      gateOwnedByRunPreset = true;
      await runPreset(preset, tsGate);
    } finally {
      // runPreset owns normal/boot-fault release. Earlier transition faults must
      // not strand every later TS request behind an unresolved gate.
      if (!gateOwnedByRunPreset) tsGate?.resolve();
    }
  }

  async function pickStarter(id: string, opts: PickStarterOpts): Promise<void> {
    const eagerGate = opts.eagerTsGate ? beginTsTransition() : undefined;
    deps.warmEditorStack();
    await queueTransition(() => bootPickedStarter(id, eagerGate, opts));
  }

  return {
    transitioning,
    beginTransition: () => setTransitioning(true),
    endTransition: () => setTransitioning(false),
    tsTransitionReady: () => tsReady,
    beginTsTransition,
    queueTransition,
    runPreset,
    pickStarter,
  };
}
