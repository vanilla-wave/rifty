import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { BootFailure } from './BootFailure.tsx';

const noop = (): void => {};

describe('BootFailure', () => {
  it('renders a standalone boot-failed alert with the cause and Retry/Reload affordances', () => {
    const html = renderToString(() =>
      BootFailure({
        error: new Error('Workbench requires Web Locks'),
        onRetry: noop,
        onReload: noop,
      }),
    );

    expect(html).toContain('data-testid="boot-failure"');
    expect(html).toContain('data-workbench-health="boot-failed"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Playground failed to start');
    expect(html).toContain('Workbench requires Web Locks');
    expect(html).toContain('data-action="retry-workbench"');
    expect(html).toMatch(/Retry<\/button>/);
    expect(html).toContain('>Reload</');
  });

  it('lists every aggregated cause without collapsing them', () => {
    const html = renderToString(() =>
      BootFailure({
        error: new AggregateError(
          [new Error('mount failed'), new Error('Workbench close failed')],
          'Playground page entry failed and cleanup failed',
        ),
        onRetry: noop,
        onReload: noop,
      }),
    );

    expect(html).toContain('Playground page entry failed and cleanup failed');
    expect(html).toContain('mount failed');
    expect(html).toContain('Workbench close failed');
  });

  it('shows a non-Error rejection value instead of hiding it', () => {
    const html = renderToString(() =>
      BootFailure({ error: 'owner boot refused', onRetry: noop, onReload: noop }),
    );

    expect(html).toContain('owner boot refused');
  });
});
