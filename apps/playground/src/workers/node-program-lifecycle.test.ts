import { describe, expect, it, vi } from 'vitest';
import {
  type NodeLifecycleDeps,
  normalizeExitCode,
  runNodeProgramLifecycle,
} from './node-program-lifecycle.ts';

function deps(over: Partial<NodeLifecycleDeps> = {}): NodeLifecycleDeps {
  return {
    runEntry: vi.fn(async () => {}),
    listPorts: vi.fn(() => [] as number[]),
    awaitDrain: vi.fn(async () => {}),
    servePreview: vi.fn(() => () => {}),
    postListening: vi.fn(),
    readExitCode: vi.fn(() => 0),
    exit: vi.fn(),
    ...over,
  };
}

describe('runNodeProgramLifecycle', () => {
  it('script (no listen): drains then exits 0', async () => {
    const d = deps();
    await runNodeProgramLifecycle(d);
    expect(d.runEntry).toHaveBeenCalledOnce();
    expect(d.awaitDrain).toHaveBeenCalledOnce();
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.postListening).not.toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it('server (listened): serves each port, posts ports, does NOT exit/drain', async () => {
    const d = deps({ listPorts: vi.fn(() => [3000, 8080]) });
    await runNodeProgramLifecycle(d);
    expect(d.servePreview).toHaveBeenCalledTimes(2);
    expect(d.servePreview).toHaveBeenCalledWith(3000);
    expect(d.servePreview).toHaveBeenCalledWith(8080);
    expect(d.postListening).toHaveBeenCalledWith([3000, 8080]);
    expect(d.awaitDrain).not.toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('entry process.exit code propagates (drain + preview skipped)', async () => {
    const err = Object.assign(new Error('x'), { code: 'RIFTY_PROCESS_EXIT', exitCode: 3 });
    const d = deps({
      runEntry: vi.fn(async () => {
        throw err;
      }),
    });
    await runNodeProgramLifecycle(d);
    expect(d.exit).toHaveBeenCalledWith(3);
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.awaitDrain).not.toHaveBeenCalled();
  });

  it('a non-exit throw propagates (surfaced by kernel worker-entry)', async () => {
    const d = deps({
      runEntry: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(runNodeProgramLifecycle(d)).rejects.toThrow('boom');
    expect(d.exit).not.toHaveBeenCalled();
  });

  // D3 (ADR-0157 review): a server that listen()s THEN throws must NOT post a
  // preview slot — the throw short-circuits before listPorts/servePreview, so the
  // owner never adds (and never has to clean up) a slot for a realm that died.
  it('a listen()-then-throw never serves a preview or posts ports', async () => {
    const d = deps({
      listPorts: vi.fn(() => [3000]), // it DID listen…
      runEntry: vi.fn(async () => {
        throw new Error('late'); // …then threw
      }),
    });
    await expect(runNodeProgramLifecycle(d)).rejects.toThrow('late');
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.postListening).not.toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
  });

  // D4 (ADR-0157 review): natural exit honours process.exitCode (Node parity).
  it('natural exit exits with process.exitCode, not a hardcoded 0', async () => {
    const d = deps({ readExitCode: vi.fn(() => 7) });
    await runNodeProgramLifecycle(d);
    expect(d.awaitDrain).toHaveBeenCalledOnce();
    expect(d.exit).toHaveBeenCalledWith(7);
  });

  it('a listened server ignores process.exitCode (stays alive, no exit)', async () => {
    const d = deps({ listPorts: vi.fn(() => [3000]), readExitCode: vi.fn(() => 7) });
    await runNodeProgramLifecycle(d);
    expect(d.exit).not.toHaveBeenCalled();
  });
});

describe('normalizeExitCode (Node uint8 coercion)', () => {
  it('passes through an in-range integer', () => {
    expect(normalizeExitCode(7)).toBe(7);
    expect(normalizeExitCode(0)).toBe(0);
    expect(normalizeExitCode(255)).toBe(255);
  });
  it('wraps out-of-range integers to 8 bits like Node', () => {
    expect(normalizeExitCode(256)).toBe(0);
    expect(normalizeExitCode(257)).toBe(1);
    expect(normalizeExitCode(-1)).toBe(255);
  });
  // normalizeExitCode is ONLY the final uint8 wrap — Node's string coercion +
  // loud validation lives in the process.exitCode SETTER (see install-process-gate
  // test). A raw non-number here is a defensive default to 0, NOT a parity claim
  // that this function coerces strings (the setter turns '7' into 7 first).
  it('defensively defaults a non-number to 0 (strings are coerced by the setter, not here)', () => {
    expect(normalizeExitCode(undefined)).toBe(0);
    expect(normalizeExitCode(Number.NaN)).toBe(0);
    expect(normalizeExitCode(null)).toBe(0);
  });
});
