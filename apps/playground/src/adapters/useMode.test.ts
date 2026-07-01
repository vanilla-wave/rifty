/**
 * Unit tests for `useMode` — the playground mode state machine.
 *
 * The extraction's contract is that `App.tsx` owns the visible terminal command
 * while this machine owns only mode/port state. We test the parts that
 * don't require booting a real dev server: initial state, preset loading, and
 * idempotent disposal.
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
  it('starts in real-vite mode', () => {
    createRoot((dispose) => {
      const m = useMode({});
      expect(m.mode()).toBe('real-vite');
      dispose();
    });
  });

  it('exposes the configured initial real-vite port', () => {
    createRoot((dispose) => {
      const m = useMode({ realVitePort: 5179 });
      expect(m.realVitePort()).toBe(5179);
      dispose();
    });
  });

  it('falls back to port 5174 when none is configured', () => {
    createRoot((dispose) => {
      const m = useMode({});
      expect(m.realVitePort()).toBe(5174);
      dispose();
    });
  });

  it('uses the no-op default logger when none is provided', () => {
    createRoot((dispose) => {
      // The contract is "safe to construct before the terminal is wired".
      // Asserting no-throw is the cheapest expression of that.
      expect(() => useMode({})).not.toThrow();
      dispose();
    });
  });

  it('dispose is idempotent', () => {
    createRoot((dispose) => {
      const m = useMode({});
      m.dispose();
      expect(() => m.dispose()).not.toThrow();
      expect(m.mode()).toBe('real-vite');
      dispose();
    });
  });

  it('logger option is accepted without owning editor file contents', () => {
    createRoot((dispose) => {
      const { log, calls } = makeLog();
      const m = useMode({ log });
      expect(calls).toHaveLength(0);
      expect(m.mode()).toBe('real-vite');
      dispose();
    });
  });

  it('loadPreset switches mode and updates the template port', async () => {
    await createRoot(async (dispose) => {
      const m = useMode({ realVitePort: 5123 });

      await m.loadPreset({
        mode: 'real-vite',
        templateId: 'vite',
      });

      expect(m.mode()).toBe('real-vite');
      expect(m.realVitePort()).toBe(5174);
      dispose();
    });
  });
});
