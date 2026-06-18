import { describe, expect, it, vi } from 'vitest';
import { type NodeLifecycleDeps, runNodeProgramLifecycle } from './node-program-lifecycle.ts';

function deps(over: Partial<NodeLifecycleDeps> = {}): NodeLifecycleDeps {
  return {
    runEntry: vi.fn(async () => {}),
    listPorts: vi.fn(() => [] as number[]),
    awaitDrain: vi.fn(async () => {}),
    servePreview: vi.fn(() => () => {}),
    postListening: vi.fn(),
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
    const d = deps({ runEntry: vi.fn(async () => { throw err; }) });
    await runNodeProgramLifecycle(d);
    expect(d.exit).toHaveBeenCalledWith(3);
    expect(d.servePreview).not.toHaveBeenCalled();
    expect(d.awaitDrain).not.toHaveBeenCalled();
  });

  it('a non-exit throw propagates (surfaced by kernel worker-entry)', async () => {
    const d = deps({ runEntry: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(runNodeProgramLifecycle(d)).rejects.toThrow('boom');
    expect(d.exit).not.toHaveBeenCalled();
  });
});
