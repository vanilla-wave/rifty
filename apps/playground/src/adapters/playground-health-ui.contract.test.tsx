import type {
  WorkbenchHealth,
  WorkbenchHealthSnapshot,
  WorkbenchRecoveryScope,
} from '@riftydev/workbench';
import { createRoot } from 'solid-js';
import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { PlaygroundHealthBanner, createPlaygroundHealthUi } from './playground-health-ui.tsx';

const HEALTHY: WorkbenchHealthSnapshot = Object.freeze({ disposition: 'healthy', issues: [] });

function fakeHealth(initial: WorkbenchHealthSnapshot = HEALTHY): {
  readonly health: WorkbenchHealth;
  publish(snapshot: WorkbenchHealthSnapshot): void;
  readonly recover: ReturnType<typeof vi.fn>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
} {
  let snapshot = initial;
  let listener: ((next: WorkbenchHealthSnapshot) => void) | null = null;
  const recover = vi.fn(async (_scope: WorkbenchRecoveryScope) => {});
  // Keep the callback reachable after unsubscribe to adversarially prove the
  // UI's generation fence rather than trusting a cooperative source.
  const unsubscribe = vi.fn();
  return {
    health: {
      snapshot: () => snapshot,
      subscribe(next) {
        listener = next;
        next(snapshot);
        return unsubscribe;
      },
      recover,
    },
    publish(next) {
      snapshot = next;
      listener?.(next);
    },
    recover,
    unsubscribe,
  };
}

describe('playground persistent health UI', () => {
  it('keeps opening and boot failure persistent, with an explicit retry', () => {
    createRoot((dispose) => {
      const ui = createPlaygroundHealthUi();
      expect(ui.boot()).toEqual({ kind: 'opening' });
      ui.bootFailed(new Error('owner script refused to load'));
      expect(ui.boot()).toEqual({
        kind: 'boot-failed',
        summary: 'owner script refused to load',
      });
      const html = renderToString(() =>
        PlaygroundHealthBanner({
          boot: ui.boot,
          issues: ui.issues,
          onRetry: () => {},
          onRecover: () => {},
          onReload: () => {},
        }),
      );
      expect(html).toContain('data-workbench-health="boot-failed"');
      expect(html).toContain('owner script refused to load');
      expect(html).toContain('data-action="retry-workbench"');
      ui.beginBoot();
      expect(ui.boot()).toEqual({ kind: 'opening' });
      ui.dispose();
      dispose();
    });
  });

  it.each(['idle owner exit', 'active owner exit'])('%s stays visible and offers reload', () => {
    createRoot((dispose) => {
      const owner = fakeHealth();
      const ui = createPlaygroundHealthUi();
      ui.bindWorkbench(owner.health);
      owner.publish({
        disposition: 'unavailable',
        issues: [
          {
            kind: 'unavailable',
            scope: 'owner',
            summary: 'Workbench owner exited unexpectedly',
            recovery: 'reload',
          },
        ],
      });
      expect(ui.issue()?.kind).toBe('unavailable');
      const html = renderToString(() =>
        PlaygroundHealthBanner({
          boot: ui.boot,
          issues: ui.issues,
          onRetry: () => {},
          onRecover: () => {},
          onReload: () => {},
        }),
      );
      expect(html).toContain('data-workbench-health="unavailable"');
      expect(html).toContain('data-action="reload-workbench"');
      ui.dispose();
      dispose();
    });
  });

  it('switches session generations, fences late callbacks, and routes recovery to the issue owner', async () => {
    await createRoot(async (dispose) => {
      const workbench = fakeHealth();
      const first = fakeHealth();
      const second = fakeHealth();
      const ui = createPlaygroundHealthUi();
      ui.bindWorkbench(workbench.health);
      ui.bindSession(first.health);
      first.publish({
        disposition: 'degraded',
        issues: [
          { kind: 'degraded', scope: 'scm', summary: 'Git refresh failed', recovery: 'scm' },
        ],
      });
      expect(ui.issue()?.scope).toBe('scm');
      ui.bindSession(second.health);
      expect(first.unsubscribe).toHaveBeenCalledOnce();
      expect(ui.issue()).toBeUndefined();
      first.publish({
        disposition: 'fatal',
        issues: [
          { kind: 'fatal', scope: 'invariant', summary: 'late old failure', recovery: 'reload' },
        ],
      });
      expect(ui.issue()).toBeUndefined();
      second.publish({
        disposition: 'degraded',
        issues: [
          {
            kind: 'degraded',
            scope: 'preview',
            summary: 'Preview routing failed',
            recovery: 'preview',
          },
        ],
      });
      await ui.recover('preview');
      expect(second.recover).toHaveBeenCalledWith('preview');
      expect(workbench.recover).not.toHaveBeenCalled();
      ui.dispose();
      expect(second.unsubscribe).toHaveBeenCalledOnce();
      dispose();
    });
  });

  it('shows persistence risk immediately and clears it only after health proves recovery', async () => {
    await createRoot(async (dispose) => {
      const session = fakeHealth();
      const ui = createPlaygroundHealthUi();
      ui.bindSession(session.health);
      session.publish({
        disposition: 'degraded',
        issues: [
          {
            kind: 'degraded',
            scope: 'persistence',
            summary: 'OPFS quota exceeded',
            recovery: 'persistence',
          },
        ],
      });
      expect(ui.persistenceAtRisk()).toBe(true);
      await ui.recover('persistence');
      session.publish(HEALTHY);
      expect(ui.issue()).toBeUndefined();
      expect(ui.persistenceAtRisk()).toBe(false);
      ui.dispose();
      dispose();
    });
  });

  it('does not let SCM or preview degradation hide a higher-severity persistence/fatal issue', () => {
    createRoot((dispose) => {
      const owner = fakeHealth({
        disposition: 'fatal',
        issues: [
          {
            kind: 'fatal',
            scope: 'invariant',
            summary: 'Protocol invariant failed',
            recovery: 'reload',
          },
          { kind: 'degraded', scope: 'scm', summary: 'Git refresh failed', recovery: 'scm' },
        ],
      });
      const session = fakeHealth({
        disposition: 'degraded',
        issues: [
          {
            kind: 'degraded',
            scope: 'persistence',
            summary: 'Storage flush failed',
            recovery: 'persistence',
          },
          {
            kind: 'degraded',
            scope: 'preview',
            summary: 'Preview route failed',
            recovery: 'preview',
          },
        ],
      });
      const ui = createPlaygroundHealthUi();
      ui.bindWorkbench(owner.health);
      ui.bindSession(session.health);
      expect(ui.issue()?.kind).toBe('fatal');
      expect(ui.persistenceAtRisk()).toBe(true);
      ui.dispose();
      dispose();
    });
  });
});
