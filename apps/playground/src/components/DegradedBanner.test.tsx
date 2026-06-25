import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { DegradedBanner } from './DegradedBanner.tsx';

describe('DegradedBanner', () => {
  it('renders the honest-loud persistence-off copy and controls', () => {
    const html = renderToString(() =>
      DegradedBanner({ onReEnable: () => {}, onDismiss: () => {} }),
    );
    expect(html).toContain('data-banner="degraded"');
    expect(html).toContain('Persistence is off — this session only');
    expect(html).toContain('projects and scratch live in memory');
    expect(html).toContain('data-action="reenable-storage"');
    expect(html).toContain('Re-enable');
    expect(html).toContain('data-action="dismiss-degraded"');
  });
});
