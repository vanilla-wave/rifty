/**
 * Mode state machine for the playground top-level UI. Owns the mutually-exclusive
 * `repl | dev | real-vite` state plus the inner handles, exposes one transition
 * per direction (`toggleDev` / `toggleRealVite`), and routes editor edits to the
 * active handle. Extraction flagged in the 2026-05-26 architecture review (Tier 4:
 * App.tsx god-component).
 *
 * Transitions preserve the original `App.tsx` semantics byte-for-byte so the e2e
 * suite (`m7-preview-sw.spec.ts`, `m10-hmr.spec.ts`, etc.) keeps passing — including
 * edge cases the original didn't cover (e.g. "Dev Mode" while in `real-vite`); fixing
 * those is a separate behavioural change.
 *
 * Must run inside a Solid root: callers invoke it from `App.tsx`'s component body
 * (same convention as `useRuntime` / `useShellSession`).
 */

import { createSignal, onCleanup } from 'solid-js';
import { type DevModeHandle, startDevMode } from '../glue/devMode.ts';
import { type RealViteHandle, startRealVite } from '../glue/realVite.ts';
import type { ProjectSpec } from '../templates/project-spec.ts';
import { defaultProjectSpec, resolveProjectSpec } from '../templates/registry.ts';

export type Mode = 'repl' | 'dev' | 'real-vite';

/** Initial editor content per mode, so the machine owns the full
 *  mode → editor-content mapping. */
export interface ModeSources {
  readonly repl: string;
  readonly dev: string;
}

/** Stream sink for transition progress messages (e.g. `[entering dev mode …]`);
 *  `App.tsx` typically forwards them to the runtime terminal writer. */
export type ModeLogger = (chunk: string, stream?: 'stdout' | 'stderr') => void;

export interface UseModeOptions {
  /** Initial editor content for each mode. */
  readonly sources: ModeSources;
  /** Default port for real-vite; machine updates it after a successful start
   *  (the adapter may negotiate a different port). Defaults to the template's
   *  `defaultPort`. */
  readonly realVitePort?: number;
  /** Real-project template to run (ADR-0078). Defaults to the registered default
   *  (Vite); drives the default port and status copy. */
  readonly template?: ProjectSpec;
  /** Receives every transition log line. Defaults to a no-op so the machine is
   *  safe to construct before the terminal is wired. */
  readonly log?: ModeLogger;
}

export interface ModeMachine {
  /** Current mode. Reactive. */
  mode(): Mode;
  /** Editor content for the active mode. Reactive. */
  source(): string;
  /** Real-vite port, updated after `toggleRealVite` resolves to `real-vite`. Reactive. */
  realVitePort(): number;
  /**
   * Replace the editor source for the active mode and forward it to the
   * underlying handle if the mode owns one (`dev`, `real-vite`). REPL has no
   * handle to notify.
   */
  setSource(next: string): void;
  /**
   * Toggle dev mode (mirrors original `onToggleMode`): `repl` enters dev on port
   * 3000; any other mode tears down the dev handle and returns to `repl`. The else
   * arm does NOT tear down a live real-vite handle — preserved for e2e parity.
   */
  toggleDev(): Promise<void>;
  /**
   * Toggle real-vite mode (mirrors original `onToggleRealVite`): from `real-vite`
   * returns to `repl`; from any other mode starts a fresh `RealViteHandle`. Entering
   * from `dev` does NOT tear down the live dev handle — preserved for e2e parity.
   */
  toggleRealVite(): Promise<void>;
  /**
   * Seed the editor with `source` and transition into `preset.mode`, starting/stopping
   * handles as needed. Idempotent within a mode (re-selecting a dev preset while in dev
   * just re-seeds). Distinct from {@link toggleDev}/{@link toggleRealVite} (header buttons)
   * so e2e toggle semantics stay untouched.
   */
  loadPreset(preset: {
    readonly mode: Mode;
    readonly source: string;
    readonly templateId?: string;
  }): Promise<void>;
  /** Dispose all handles. Idempotent; called by `onCleanup` automatically. */
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
    // Per-preset template (defaults to machine template) lets the gallery scale
    // to more templates without header surgery (ADR-0078).
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
