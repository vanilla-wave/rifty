import { defaultProjectSpec, resolveProjectSpec } from '@riftydev/workbench';
import { createSignal, onCleanup } from 'solid-js';

export type Mode = 'dev' | 'real-vite';

export interface ModeSources {
  readonly dev: string;
  readonly realVite: string;
}

export type ModeLogger = (chunk: string, stream?: 'stdout' | 'stderr') => void;

export interface UseModeOptions {
  readonly sources: ModeSources;
  readonly realVitePort?: number;
  readonly log?: ModeLogger;
}

export interface ModeMachine {
  mode(): Mode;
  source(): string;
  realVitePort(): number;
  setRealVitePort(port: number): void;
  setSource(next: string): void;
  loadPreset(preset: {
    readonly mode: Mode;
    readonly source: string;
    readonly templateId?: string;
  }): Promise<void>;
  dispose(): void;
}

export function useMode(options: UseModeOptions): ModeMachine {
  const template = defaultProjectSpec();
  const [mode, setMode] = createSignal<Mode>('real-vite');
  const [source, setSourceSignal] = createSignal(options.sources.realVite);
  const [realVitePort, setRealVitePort] = createSignal(
    options.realVitePort ?? template.defaultPort,
  );

  function setSource(next: string): void {
    setSourceSignal(next);
  }

  async function loadPreset(preset: {
    readonly mode: Mode;
    readonly source: string;
    readonly templateId?: string;
  }): Promise<void> {
    setMode(preset.mode);
    setSourceSignal(preset.source);
    if (preset.mode === 'real-vite') {
      const presetTemplate = preset.templateId ? resolveProjectSpec(preset.templateId) : template;
      setRealVitePort(presetTemplate.defaultPort);
    }
  }

  function dispose(): void {
    // No long-lived runtime handles live here anymore. Real dev server lifetime
    // belongs to the visible terminal command that started it.
  }

  onCleanup(dispose);

  return {
    mode,
    source,
    realVitePort,
    setRealVitePort,
    setSource,
    loadPreset,
    dispose,
  };
}
