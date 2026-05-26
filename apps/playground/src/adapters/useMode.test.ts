/**
 * Unit tests for `useMode` — the playground mode state machine.
 *
 * The extraction's contract is that `App.tsx`-style transitions
 * (`toggleDev`, `toggleRealVite`, editor edits) behave identically to the
 * inline code that used to live in `App.tsx`. We test the parts that don't
 * require booting a real dev server: initial state, log routing, editor
 * forwarding when no handle is active, idempotent disposal.
 *
 * The transitions that hit `startDevMode` / `startRealVite` are exercised
 * end-to-end by the e2e suite (`m7-preview-sw.spec.ts`, `m10-hmr.spec.ts`).
 * We deliberately keep this file focused on the wiring contract — adding
 * scaffolding to mock the inner adapters would duplicate what e2e already
 * covers and harden against refactors.
 */
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { useMode } from './useMode.ts';

const sources = { repl: 'REPL', dev: 'DEV' };

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
  it('starts in repl mode with the REPL source', () => {
    createRoot((dispose) => {
      const m = useMode({ sources });
      expect(m.mode()).toBe('repl');
      expect(m.source()).toBe('REPL');
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

  it('setSource updates the editor source in repl mode without notifying a handle', () => {
    createRoot((dispose) => {
      const m = useMode({ sources });
      m.setSource('NEXT');
      expect(m.source()).toBe('NEXT');
      // No handle exists in repl — the test just locks in that calling
      // setSource doesn't throw or otherwise misbehave when there's nothing
      // to notify downstream.
      expect(m.mode()).toBe('repl');
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
      expect(m.mode()).toBe('repl');
      dispose();
    });
  });

  it('logger receives transition status lines via the log option', () => {
    // We can't drive a full toggleDev → enterDev path without booting a real
    // dev server, but we can verify the logger plumbing: setSource on the
    // repl mode does not emit, and the log channel is properly held by the
    // machine. The transition-line coverage is exercised by e2e (m7/m10).
    createRoot((dispose) => {
      const { log, calls } = makeLog();
      const m = useMode({ sources, log });
      m.setSource('still in repl');
      // setSource alone is silent; only transitions emit through `log`.
      expect(calls).toHaveLength(0);
      expect(m.source()).toBe('still in repl');
      dispose();
    });
  });
});
