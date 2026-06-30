import { createSignal, onCleanup } from 'solid-js';
import { defaultProjectSpec, resolveProjectSpec } from '../templates/registry.ts';

export type Mode = 'dev' | 'real-vite';

export type ModeLogger = (chunk: string, stream?: 'stdout' | 'stderr') => void;

export interface UseModeOptions {
  readonly realVitePort?: number;
  readonly log?: ModeLogger;
}

export interface ModeMachine {
  mode(): Mode;
  realVitePort(): number;
  setRealVitePort(port: number): void;
  loadPreset(preset: {
    readonly mode: Mode;
    readonly templateId?: string;
  }): Promise<void>;
  dispose(): void;
}

export function useMode(options: UseModeOptions): ModeMachine {
  const template = defaultProjectSpec();
  const [mode, setMode] = createSignal<Mode>('real-vite');
  const [realVitePort, setRealVitePort] = createSignal(
    options.realVitePort ?? template.defaultPort,
  );

  async function loadPreset(preset: {
    readonly mode: Mode;
    readonly templateId?: string;
  }): Promise<void> {
    setMode(preset.mode);
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
    realVitePort,
    setRealVitePort,
    loadPreset,
    dispose,
  };
}
