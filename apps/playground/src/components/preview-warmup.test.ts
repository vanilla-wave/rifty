import { describe, expect, it, vi } from 'vitest';
import { runPreviewWarmup } from './preview-warmup.ts';

const CFG = {
  warmupTimeoutMs: 90_000,
  warmupIntervalMs: 400,
  probeTimeoutMs: 4_000,
  commitTimeoutMs: 4_000,
  commitIntervalMs: 200,
};

/** Manual clock: `sleep` advances it and resolves; `wake` is armed per call. */
function makeWorld(overrides: Record<string, unknown> = {}) {
  let clock = 0;
  let wakeResolve: (() => void) | null = null;
  const hooks = {
    probe: vi.fn(async () => true),
    navigate: vi.fn(async () => {}),
    committed: vi.fn(() => true),
    wake: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          wakeResolve = resolve;
        }),
    ),
    sleep: vi.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    }),
    now: () => clock,
    ...overrides,
  };
  return { hooks, fireWake: () => wakeResolve?.() };
}

describe('runPreviewWarmup', () => {
  it('goes live with ZERO interval waits when probe and commit succeed at once', async () => {
    const { hooks } = makeWorld({
      // A sleep here would mean we waited an interval we did not need.
      sleep: vi.fn(() => new Promise<void>(() => {})),
    });
    await expect(runPreviewWarmup(hooks, CFG, () => true)).resolves.toBe('live');
    expect(hooks.navigate).toHaveBeenCalledTimes(1);
    expect(hooks.sleep).not.toHaveBeenCalled();
  });

  it('an external wake() re-probes immediately instead of waiting out the interval', async () => {
    const { hooks, fireWake } = makeWorld({
      probe: vi.fn(async () => false),
      sleep: vi.fn(() => new Promise<void>(() => {})), // interval never elapses
    });
    hooks.probe.mockResolvedValueOnce(false).mockResolvedValue(true);
    const result = runPreviewWarmup(hooks, CFG, () => true);
    await vi.waitFor(() => expect(hooks.wake).toHaveBeenCalled());
    fireWake();
    await expect(result).resolves.toBe('live');
    expect(hooks.probe).toHaveBeenCalledTimes(2);
  });

  it('a wake() DURING a hung probe aborts it and re-probes immediately', async () => {
    // A probe launched before the preview bridge is wired hangs in the SW
    // ready-wait up to probeTimeoutMs; the dev-server announce must not wait it out.
    let firstProbeSignal: AbortSignal | undefined;
    let probeCalls = 0;
    const { hooks, fireWake } = makeWorld({
      probe: vi.fn((signal: AbortSignal) => {
        probeCalls += 1;
        if (probeCalls > 1) return Promise.resolve(true);
        firstProbeSignal = signal;
        return new Promise<boolean>((resolve) => {
          signal.addEventListener('abort', () => resolve(false), { once: true });
        });
      }),
      sleep: vi.fn(() => new Promise<void>(() => {})), // interval never elapses
    });
    const result = runPreviewWarmup(hooks, CFG, () => true);
    await vi.waitFor(() => expect(hooks.wake).toHaveBeenCalled());
    fireWake();
    await expect(result).resolves.toBe('live');
    expect(firstProbeSignal?.aborted).toBe(true);
    expect(probeCalls).toBe(2);
    expect(hooks.sleep).not.toHaveBeenCalled();
  });

  it('a timed-out probe phase still navigates, then errors when nothing commits', async () => {
    const { hooks } = makeWorld({
      probe: vi.fn(async () => false),
      committed: vi.fn(() => false),
    });
    await expect(runPreviewWarmup(hooks, CFG, () => true)).resolves.toBe('error');
    expect(hooks.navigate).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled and never navigates once alive flips during probing', async () => {
    let alive = true;
    const { hooks } = makeWorld({
      probe: vi.fn(async () => {
        alive = false;
        return false;
      }),
    });
    await expect(runPreviewWarmup(hooks, CFG, () => alive)).resolves.toBe('cancelled');
    expect(hooks.navigate).not.toHaveBeenCalled();
  });
});
