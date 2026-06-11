/**
 * Unit tests for `useMode` — the playground mode state machine.
 *
 * The extraction's contract is that `App.tsx` owns the visible terminal command
 * while this machine owns only mode/source/port state. We test the parts that
 * don't require booting a real dev server: initial state, source updates, preset
 * loading, and idempotent disposal.
 *
 * The transition that hits `startRealVite` is exercised end-to-end by the e2e
 * suite (`m7-preview-sw.spec.ts`, `m10-hmr.spec.ts`).
 * We deliberately keep this file focused on the wiring contract — adding
 * scaffolding to mock the inner adapters would duplicate what e2e already
 * covers and harden against refactors.
 */
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { useMode } from './useMode.ts';

const sources = { dev: 'DEV', realVite: 'REAL_VITE' };

interface LogCall {
  readonly chunk: string;
  readonly stream: 'stdout' | 'stderr' | undefined;
}

function makeLog(): { log: (c: string, s?: 'stdout' | 'stderr') => void; calls: LogCall[] } {
  const calls: LogCall[] = [];
  return {
    calls,
    log(chunk: string, stream?: 'stdout' | 'stderr') {
      calls.push({ chunk, stream });
    },
  };
}

describe('useMode', () => {
  it('starts in real-vite mode with the live preview source', () => {
    createRoot((dispose) => {
      const m = useMode({ sources });
      expect(m.mode()).toBe('real-vite');
      expect(m.source()).toBe('REAL_VITE');
      dispose();
    });
  });

  it('exposes the configured initial real-vite port', () => {
    createRoot((dispose) => {
      const m = useMode({ sources, realVitePort: 5179 });
      expect(m.realVitePort()).toBe(5179);
      dispose();
    });
  });

  it('falls back to port 5174 when none is configured', () => {
    createRoot((dispose) => {
      const m = useMode({ sources });
      expect(m.realVitePort()).toBe(5174);
      dispose();
    });
  });

  it('setSource updates the editor source without notifying a runtime handle', () => {
    createRoot((dispose) => {
      const m = useMode({ sources });
      m.setSource('NEXT');
      expect(m.source()).toBe('NEXT');
      expect(m.mode()).toBe('real-vite');
      dispose();
    });
  });

  it('uses the no-op default logger when none is provided', () => {
    createRoot((dispose) => {
      // The contract is "safe to construct before the terminal is wired".
      // Asserting no-throw is the cheapest expression of that.
      const m = useMode({ sources });
      expect(() => m.setSource('whatever')).not.toThrow();
      dispose();
    });
  });

  it('dispose is idempotent', () => {
    createRoot((dispose) => {
      const m = useMode({ sources });
      m.dispose();
      expect(() => m.dispose()).not.toThrow();
      expect(m.mode()).toBe('real-vite');
      dispose();
    });
  });

  it('logger option is accepted but source edits stay silent', () => {
    createRoot((dispose) => {
      const { log, calls } = makeLog();
      const m = useMode({ sources, log });
      m.setSource('still live preview');
      expect(calls).toHaveLength(0);
      expect(m.source()).toBe('still live preview');
      dispose();
    });
  });

  it('loadPreset switches source and updates the template port', async () => {
    await createRoot(async (dispose) => {
      const m = useMode({ sources, realVitePort: 5123 });

      await m.loadPreset({
        mode: 'real-vite',
        source: 'FROM_PRESET',
        templateId: 'vite',
      });

      expect(m.mode()).toBe('real-vite');
      expect(m.source()).toBe('FROM_PRESET');
      expect(m.realVitePort()).toBe(5174);
      dispose();
    });
  });
});
