import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets.ts';
import { StartersTab } from './StartersTab.tsx';

// Cross-Phase Reconciliation A: the canonical Starter (glue/starter.ts) is the
// seed/lifecycle entity (id/name/source/files), NOT a gallery-display shape — the
// display fields (label/blurb/glyph/setup/category) live on `Preset`. The gallery
// therefore renders from `Preset[]` directly (exactly as the moved TemplateSwitcher
// did) and groups by `GROUP_FOR_CATEGORY[preset.category]`.
const props = {
  presets: PRESETS,
  q: '',
  cat: 'all' as const,
  onPick: () => {},
  onSearch: () => {},
  onCat: () => {},
};

describe('StartersTab — the moved gallery (ADR-0079)', () => {
  it('carries the gallery container + per-preset rows (selectors MOVED here intact)', () => {
    const html = renderToString(() => StartersTab(props));
    expect(html).toContain('data-testid="gallery"');
    expect(html).toContain('data-preset="express-sqlite"');
    expect(html).toContain('data-preset="socket-lab"');
  });

  it('groups by category with a FRONT-END header', () => {
    expect(renderToString(() => StartersTab(props))).toContain('FRONT-END');
  });

  it('hides a starter that does not match the search query', () => {
    const html = renderToString(() => StartersTab({ ...props, q: 'zzz-no-match' }));
    expect(html).not.toContain('data-preset="express-sqlite"');
  });

  it('renders the npm-install setup badge for a from-scratch starter', () => {
    const html = renderToString(() => StartersTab({ ...props, q: 'real npm' }));
    expect(html).toContain('npm install');
  });

  it('CATEGORY filter hides non-matching groups (ADR-0165 §9): server/wasm cats empty out today', () => {
    // Every current preset maps to FRONT-END (GROUP_FOR_CATEGORY), so:
    //  - cat='frontend' keeps the rows; cat='server' (no server starters yet) shows none.
    const frontend = renderToString(() => StartersTab({ ...props, cat: 'frontend' }));
    expect(frontend).toContain('data-preset="express-sqlite"');
    expect(frontend).toContain('FRONT-END');

    const server = renderToString(() => StartersTab({ ...props, cat: 'server' }));
    expect(server).not.toContain('data-preset="express-sqlite"');
    expect(server).not.toContain('data-preset="socket-lab"');
    // the empty group header is hidden too (groups filter on items.length > 0)
    expect(server).not.toContain('FRONT-END');
  });

  it('the active CATEGORY chip is marked (data-active) so the filter state is visible', () => {
    const html = renderToString(() => StartersTab({ ...props, cat: 'server' }));
    // the Server chip is active, All is not — drives the highlight + asserts onCat wiring target
    expect(html).toMatch(/data-active="true"[^>]*>Server</);
  });
});
