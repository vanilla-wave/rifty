/**
 * PreviewPanel core (epic playground-testable-core): the effect-free preview
 * glue extracted from PreviewPanel.tsx so node vitest can drive it — route
 * derivation, open-tab routing, and the concrete warm-up hooks (fetch probe,
 * fresh-frame navigation) fed to the runPreviewWarmup state machine. The
 * component keeps only the DOM/signal bindings (iframe ref, keyed remount,
 * phase signal) and passes them in as a PreviewFrameHost.
 */
import {
  type PreviewWarmupConfig,
  type PreviewWarmupResult,
  runPreviewWarmup,
} from './preview-warmup.ts';

// Warm-up budget spans a Real Vite npm install + boot (ADR-0076/0077); a down
// dev server resolves to `unreachable`, just later. Per-probe cap keeps a 30 s
// cross-realm preview-bridge timeout (worker not serving yet) from blocking
// the poll loop — abort and re-probe instead.
export const PREVIEW_WARMUP_CONFIG: PreviewWarmupConfig = {
  warmupTimeoutMs: 90_000,
  warmupIntervalMs: 400,
  probeTimeoutMs: 4_000,
  commitTimeoutMs: 4_000,
  commitIntervalMs: 200,
};

/** SW-routed preview route for a virtual localhost port. Exact — no query
 * params: reloads are HMR-client-driven (ADR-0126), never `?rf=` cache-busted. */
export function previewUrlFor(port: number): string {
  return `/preview/${port}/`;
}

/** ↗ action: App's tab callback gets the selected port; without one, fall back
 * to a real window (SW routes the copied URL port-keyed, ADR-0160). */
export function openPreviewTab(
  port: number,
  onOpenTab: ((port: number) => void) | undefined,
  openWindow: (url: string, target: string) => void,
): void {
  if (onOpenTab) {
    onOpenTab(port);
    return;
  }
  openWindow(previewUrlFor(port), '_blank');
}

export interface PreviewFrameLike {
  addEventListener(type: 'load', listener: () => void, options: { once: boolean }): void;
  src: string;
}

/** Component-side bindings for one warm-up run. */
export interface PreviewFrameHost {
  readonly fetchImpl: typeof fetch;
  /** Live iframe ref; undefined between remount and the keyed re-ref. */
  readonly currentFrame: () => PreviewFrameLike | undefined;
  /** Drop + recreate the iframe (keyed epoch bump) so the SW controls the
   * fresh document from its first request (ADR-0074). */
  readonly remountFrame: () => void;
  /** Did the iframe commit a document at the preview URL? */
  readonly committed: () => boolean;
  /** Arm a one-shot readiness wake (dev-server announce / frame load). */
  readonly armWake: () => Promise<void>;
  readonly fireWake: () => void;
  readonly isAlive: () => boolean;
}

/** One warm-up run: probe the route, then navigate a FRESH frame and confirm
 * the document committed. Hook semantics live here; the loop in runPreviewWarmup. */
export function runPreviewFrameWarmup(
  url: string,
  host: PreviewFrameHost,
  cfg: PreviewWarmupConfig = PREVIEW_WARMUP_CONFIG,
): Promise<PreviewWarmupResult> {
  return runPreviewWarmup(
    {
      probe: async (signal) => {
        try {
          const res = await host.fetchImpl(url, { method: 'GET', cache: 'no-store', signal });
          await res.body?.cancel().catch(() => {});
          return res.ok;
        } catch {
          return false; // server/SW not ready, or probe aborted — keep polling
        }
      },
      // Route reachable — remount so the SW controls the document, then load.
      // The fresh frame's load event wakes the commit check (cross-browser:
      // fast where the nav commits, falls through to `error` where it aborts).
      navigate: async () => {
        if (!host.currentFrame()) return;
        host.remountFrame();
        await new Promise((r) => setTimeout(r, 0));
        const nextFrame = host.currentFrame();
        if (!host.isAlive() || !nextFrame) return;
        nextFrame.addEventListener('load', () => host.fireWake(), { once: true });
        nextFrame.src = url;
      },
      committed: host.committed,
      wake: host.armWake,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
    },
    cfg,
    host.isAlive,
  );
}
