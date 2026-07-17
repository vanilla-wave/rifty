import { describe, expect, it, vi } from 'vitest';
import {
  type PreviewFrameHost,
  type PreviewFrameLike,
  openPreviewTab,
  runPreviewFrameWarmup,
} from './preview-panel-core.ts';

class FakeFrame implements PreviewFrameLike {
  onLoad: (() => void) | null = null;
  readonly srcWrites: string[] = [];
  constructor(private readonly log: string[]) {}
  addEventListener(_type: 'load', listener: () => void, _options: { once: boolean }): void {
    this.onLoad = listener;
  }
  get src(): string {
    return this.srcWrites.at(-1) ?? 'about:blank';
  }
  set src(url: string) {
    this.srcWrites.push(url);
    this.log.push(`src:${url}`);
  }
}

/** One-frame world: remount swaps in a fresh frame (what the keyed epoch bump
 * does client-side) and logs ordering. */
function makeHost(overrides: Partial<PreviewFrameHost> = {}) {
  const log: string[] = [];
  const frames: FakeFrame[] = [new FakeFrame(log)];
  let wake: (() => void) | null = null;
  const host: PreviewFrameHost = {
    fetchImpl: async () => new Response('ok'),
    currentFrame: () => frames.at(-1),
    remountFrame: () => {
      log.push('remount');
      frames.push(new FakeFrame(log));
    },
    committed: vi.fn(() => true),
    armWake: () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      }),
    fireWake: vi.fn(() => wake?.()),
    isAlive: () => true,
    ...overrides,
  };
  return { host, log, frames };
}

describe('preview-panel-core', () => {
  it('open-tab passes the exact registry-routed URL to the App callback', () => {
    const routedUrl = '/owner-routes/session-a/preview-5174';
    const onOpenTab = vi.fn();
    const openWindow = vi.fn();
    openPreviewTab(routedUrl, onOpenTab, openWindow);
    expect(onOpenTab).toHaveBeenCalledTimes(1);
    expect(onOpenTab).toHaveBeenCalledWith(routedUrl);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('open-tab without a callback uses the exact registry-routed URL, never a port-derived route', () => {
    const routedUrl = '/owner-routes/session-a/preview-3000';
    const openWindow = vi.fn();
    openPreviewTab(routedUrl, undefined, openWindow);
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith(routedUrl, '_blank');
  });

  it('probes the route with a no-store GET and drains the body before reporting ok', async () => {
    let cancelled = false;
    const inits: RequestInit[] = [];
    const { host } = makeHost({
      fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init) inits.push(init);
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
    });
    await expect(runPreviewFrameWarmup('/preview/5174/', host)).resolves.toBe('live');
    expect(inits[0]).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(cancelled).toBe(true); // body drained — no h2 stream left dangling
  });

  it('recreates the iframe BEFORE navigation and navigates only the fresh frame', async () => {
    const { host, log, frames } = makeHost();
    await expect(runPreviewFrameWarmup('/preview/5174/', host)).resolves.toBe('live');
    // Remount precedes the src write, so the SW controls the new document.
    expect(log).toEqual(['remount', 'src:/preview/5174/']);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.srcWrites).toEqual([]); // pre-remount frame never navigated
    expect(frames[1]?.srcWrites).toEqual(['/preview/5174/']);
  });

  it('wires the fresh frame load event to the commit-check wake', async () => {
    const { host, frames } = makeHost();
    await expect(runPreviewFrameWarmup('/preview/3000/', host)).resolves.toBe('live');
    const fresh = frames.at(-1);
    expect(fresh?.onLoad).toBeTypeOf('function');
    fresh?.onLoad?.();
    expect(host.fireWake).toHaveBeenCalled();
  });

  it('a run cancelled during remount never writes src into the fresh frame', async () => {
    let alive = true;
    const { host, frames } = makeHost({ isAlive: () => alive });
    const remount = host.remountFrame;
    const cancellingHost: PreviewFrameHost = {
      ...host,
      remountFrame: () => {
        remount();
        alive = false; // component unmounted mid-navigation
      },
    };
    await expect(runPreviewFrameWarmup('/preview/3000/', cancellingHost)).resolves.toBe(
      'cancelled',
    );
    expect(frames.at(-1)?.srcWrites).toEqual([]);
  });
});
