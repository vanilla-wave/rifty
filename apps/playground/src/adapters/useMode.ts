/**
 * Mode state machine for the playground top-level UI.
 *
 * `App.tsx` used to keep `mode`, the dev-mode handle, the real-vite handle,
 * the real-vite port, and the editor source all in side-by-side signals,
 * with three `onToggle*` methods branching on `mode()` to dispatch into the
 * right adapter handle. The shape was flagged in the 2026-05-26 architecture
 * review (Tier 4: "App.tsx is already a 292-line god-component juggling 5
 * signals and 3 modes") and called out again in `shell-adapter.ts`'s own
 * docstring as the pattern to extract before adding more modes.
 *
 * This adapter is the extraction: it owns the mutually-exclusive
 * `repl | dev | real-vite` state plus the inner handles, exposes one
 * transition per direction (`toggleDev` / `toggleRealVite`), and routes
 * editor edits to whichever underlying handle is active. `App.tsx` shrinks
 * to JSX + wiring; the mode machine stays here.
 *
 * The transitions preserve the original `App.tsx` semantics byte-for-byte
 * so the e2e suite (`m7-preview-sw.spec.ts`, `m10-hmr.spec.ts`, etc.) keeps
 * passing without edits. The handful of edge cases the original code didn't
 * cover (e.g. pressing "Dev Mode" while in `real-vite`) are preserved as-is
 * — fixing them is a separate behavioural change outside this refactor.
 *
 * The hook stays framework-light by Solid's standards: a single Solid signal
 * per piece of state, `onCleanup` to tear down handles on unmount, no
 * reactive computations. It runs inside a Solid root because callers invoke
 * it from `App.tsx`'s component body (the same convention as `useRuntime`
 * and `useShellSession`).
 */

import { createSignal, onCleanup } from 'solid-js';
import { type DevModeHandle, startDevMode } from '../glue/devMode.ts';
import { type RealViteHandle, startRealVite } from '../glue/realVite.ts';
import type { ProjectSpec } from '../templates/project-spec.ts';
import { defaultProjectSpec, resolveProjectSpec } from '../templates/registry.ts';

export type Mode = 'repl' | 'dev' | 'real-vite';

/** Initial-source presets for each mode. Kept here so the machine owns the
 *  full mode → editor-content mapping; `App.tsx` doesn't need to know which
 *  template to flip to on a transition. */
export interface ModeSources {
  readonly repl: string;
  readonly dev: string;
}

/** Stream sink for transition progress messages. The machine writes status
 *  lines (`[entering dev mode …]`, `[real-vite] installing vite …`) through
 *  this; `App.tsx` typically forwards them to the runtime terminal writer. */
export type ModeLogger = (chunk: string, stream?: 'stdout' | 'stderr') => void;

export interface UseModeOptions {
  /** Initial editor content for each mode. */
  readonly sources: ModeSources;
  /** Default port for real-vite. The machine updates it after a successful
   *  start (the adapter is free to negotiate a different port). Defaults to the
   *  active template's `defaultPort`. */
  readonly realVitePort?: number;
  /** The real-project template to run (ADR-0078). Defaults to the registered
   *  default (Vite). Drives the default port and the generic status copy. */
  readonly template?: ProjectSpec;
  /** Receives every transition log line. Defaults to a no-op so the machine
   *  is safe to construct before the terminal is wired. */
  readonly log?: ModeLogger;
}

export interface ModeMachine {
  /** Current mode. Reactive — consume from JSX or `createEffect`. */
  mode(): Mode;
  /** Editor content for the active mode. Reactive. */
  source(): string;
  /** Real-vite port (updated after `toggleRealVite` resolves to `real-vite`).
   *  Reactive. */
  realVitePort(): number;
  /**
   * Replace the editor source for the active mode and forward the change to
   * the underlying handle if the mode owns one (`dev`, `real-vite`).
   * REPL mode just stores the value — there is no handle to notify.
   */
  setSource(next: string): void;
  /**
   * Toggle dev mode. Mirrors the original `onToggleMode` in `App.tsx`:
   * `repl` enters dev on port 3000; any other mode tears down the dev
   * handle (if any) and returns to `repl`. The original branch did NOT
   * tear down a live real-vite handle in the else arm — preserved here
   * for behavioural parity with the e2e tests.
   */
  toggleDev(): Promise<void>;
  /**
   * Toggle real-vite mode. Mirrors the original `onToggleRealVite` in
   * `App.tsx`: from `real-vite` returns to `repl`; from any other mode
   * (`repl` or `dev`) starts a fresh `RealViteHandle`. The original
   * branch did NOT tear down a live dev handle when entering from `dev`
   * — preserved here for behavioural parity.
   */
  toggleRealVite(): Promise<void>;
  /**
   * Load a preset: seed the editor with `source` and transition into the
   * preset's `mode`, starting/stopping the dev/real-vite handles as needed.
   * Idempotent within a mode (re-selecting a dev preset while already in dev
   * just re-seeds the entry). Distinct from {@link toggleDev}/{@link toggleRealVite}
   * (which the header buttons use) so the e2e toggle semantics stay untouched.
   */
  loadPreset(preset: {
    readonly mode: Mode;
    readonly source: string;
    readonly templateId?: string;
  }): Promise<void>;
  /** Dispose all handles. Idempotent. Called by `onCleanup` automatically. */
  dispose(): void;
}

export function useMode(options: UseModeOptions): ModeMachine {
  const sources = options.sources;
  const log = options.log ?? (() => {});
  const template = options.template ?? defaultProjectSpec();

  const [mode, setMode] = createSignal<Mode>('repl');
  const [source, setSourceSignal] = createSignal(sources.repl);
  const [devHandle, setDevHandle] = createSignal<DevModeHandle | null>(null);
  const [realViteHandle, setRealViteHandle] = createSignal<RealViteHandle | null>(null);
  const [realVitePort, setRealVitePort] = createSignal(
    options.realVitePort ?? template.defaultPort,
  );

  const startingRealViteLine = `\n[starting ${template.displayName} — installing from npm, this may take ~${template.estimatedBootSeconds}s]\n`;

  async function toggleDev(): Promise<void> {
    if (mode() === 'repl') {
      log('\n[entering dev mode — starting dev server on port 3000]\n');
      try {
        const handle = await startDevMode({ port: 3000 });
        setDevHandle(handle);
        setMode('dev');
        setSourceSignal(sources.dev);
        handle.updateEntry(sources.dev);
      } catch (err) {
        log(`dev mode failed: ${(err as Error).message}\n`, 'stderr');
      }
      return;
    }
    const handle = devHandle();
    if (handle) await handle.close();
    setDevHandle(null);
    setMode('repl');
    setSourceSignal(sources.repl);
    log('\n[left dev mode]\n');
  }

  async function toggleRealVite(): Promise<void> {
    if (mode() === 'real-vite') {
      const h = realViteHandle();
      if (h) await h.close();
      setRealViteHandle(null);
      setMode('repl');
      setSourceSignal(sources.repl);
      log('\n[left real-vite mode]\n');
      return;
    }
    log(startingRealViteLine);
    try {
      const handle = await startRealVite({
        template,
        port: realVitePort(),
        onLog: (line) => log(line),
      });
      setRealViteHandle(handle);
      setRealVitePort(handle.port);
      setMode('real-vite');
      setSourceSignal(sources.dev);
      handle.updateEntry(sources.dev);
    } catch (err) {
      log(`real-vite failed: ${(err as Error).stack ?? (err as Error).message}\n`, 'stderr');
    }
  }

  function setSource(next: string): void {
    setSourceSignal(next);
    if (mode() === 'dev') devHandle()?.updateEntry(next);
    if (mode() === 'real-vite') realViteHandle()?.updateEntry(next);
  }

  /** Tear down whichever server handle is live and return to REPL. */
  async function leaveServers(): Promise<void> {
    const dev = devHandle();
    if (dev) await dev.close();
    setDevHandle(null);
    const rv = realViteHandle();
    if (rv) await rv.close();
    setRealViteHandle(null);
    setMode('repl');
  }

  async function loadPreset(preset: {
    readonly mode: Mode;
    readonly source: string;
    readonly templateId?: string;
  }): Promise<void> {
    const entry = preset.source;
    if (preset.mode === 'repl') {
      if (mode() !== 'repl') await leaveServers();
      setSourceSignal(entry);
      return;
    }
    if (preset.mode === 'dev') {
      if (mode() === 'dev') {
        setSource(entry);
        return;
      }
      if (mode() === 'real-vite') {
        const rv = realViteHandle();
        if (rv) await rv.close();
        setRealViteHandle(null);
      }
      log('\n[entering dev mode — starting dev server on port 3000]\n');
      try {
        const handle = await startDevMode({ port: 3000 });
        setDevHandle(handle);
        setMode('dev');
        setSourceSignal(entry);
        handle.updateEntry(entry);
      } catch (err) {
        log(`dev mode failed: ${(err as Error).message}\n`, 'stderr');
      }
      return;
    }
    // preset.mode === 'real-vite'
    if (mode() === 'real-vite') {
      setSource(entry);
      return;
    }
    if (mode() === 'dev') {
      const dev = devHandle();
      if (dev) await dev.close();
      setDevHandle(null);
    }
    // Resolve the preset's template (defaults to the machine template). Lets
    // the gallery scale to more templates (ADR-0078) without new header surgery.
    const presetTemplate = preset.templateId ? resolveProjectSpec(preset.templateId) : template;
    if (presetTemplate.defaultPort !== realVitePort()) setRealVitePort(presetTemplate.defaultPort);
    log(
      `\n[starting ${presetTemplate.displayName} — installing from npm, this may take ~${presetTemplate.estimatedBootSeconds}s]\n`,
    );
    try {
      const handle = await startRealVite({
        template: presetTemplate,
        port: realVitePort(),
        onLog: (line) => log(line),
      });
      setRealViteHandle(handle);
      setRealVitePort(handle.port);
      setMode('real-vite');
      setSourceSignal(entry);
      handle.updateEntry(entry);
    } catch (err) {
      log(`real-vite failed: ${(err as Error).stack ?? (err as Error).message}\n`, 'stderr');
    }
  }

  function dispose(): void {
    void devHandle()?.close();
    void realViteHandle()?.close();
    setDevHandle(null);
    setRealViteHandle(null);
  }

  onCleanup(dispose);

  return {
    mode,
    source,
    realVitePort,
    setSource,
    toggleDev,
    toggleRealVite,
    loadPreset,
    dispose,
  };
}
