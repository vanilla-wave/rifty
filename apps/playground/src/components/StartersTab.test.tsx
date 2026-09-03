import { NODE_PROCESS_IDENTITY } from '@riftydev/runtime-js/builtins/process-identity';
import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets.ts';
import { StartersTab } from './StartersTab.tsx';

// Cross-Phase Reconciliation A: the canonical Starter (glue/starter.ts) is the
// seed/lifecycle entity (id/name/files), NOT a gallery-display shape — the
// display fields (label/blurb/glyph/setup/category) live on `Preset`. The gallery
// therefore renders from `Preset[]` directly (exactly as the moved TemplateSwitcher
// did) and groups via `groupForPreset` (node runtime → SERVER, else category map).
const props = {
  presets: PRESETS,
  q: '',
  cat: 'all' as const,
  ownerBlocked: false,
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

  it('labels server starters from the runtime identity instead of stale copy', () => {
    const major = NODE_PROCESS_IDENTITY.versions.node.split('.')[0];
    const html = renderToString(() => StartersTab(props));

    expect(html).toContain(`Node ${major} runtime`);
    expect(html).not.toContain('Node 22 runtime');
  });

  it('hides a starter that does not match the search query', () => {
    const html = renderToString(() => StartersTab({ ...props, q: 'zzz-no-match' }));
    expect(html).not.toContain('data-preset="express-sqlite"');
  });

  it('renders the npm-install setup badge for a from-scratch starter', () => {
    const html = renderToString(() => StartersTab({ ...props, q: 'real npm' }));
    expect(html).toContain('npm install');
  });

  it('CATEGORY filter groups node-runtime starters under SERVER, Vite apps under FRONT-END', () => {
    // Vite/front-end presets group under FRONT-END; node-server / node-cli
    // presets (express/socket-lab/hono/koa/markdown-ssg/cli-report) group under
    // SERVER by their resolved runtime (groupForPreset) — NOT as a Vite dev server.
    const frontend = renderToString(() => StartersTab({ ...props, cat: 'frontend' }));
    expect(frontend).toContain('data-preset="real-vite"');
    expect(frontend).toContain('FRONT-END');
    expect(frontend).not.toContain('data-preset="hono-api"');
    expect(frontend).not.toContain('data-preset="express-sqlite"'); // node-server -> SERVER

    const server = renderToString(() => StartersTab({ ...props, cat: 'server' }));
    expect(server).toContain('SERVER');
    expect(server).toContain('data-preset="hono-api"');
    expect(server).toContain('data-preset="cli-report"'); // node-cli
    expect(server).toContain('data-preset="express-sqlite"'); // Express is a node server
    // Vite presets stay out of the SERVER group, and FRONT-END is not shown here.
    expect(server).not.toContain('data-preset="real-vite"');
    expect(server).not.toContain('FRONT-END');
  });

  it('the active CATEGORY chip is marked (data-active) so the filter state is visible', () => {
    const html = renderToString(() => StartersTab({ ...props, cat: 'server' }));
    // the Server chip is active, All is not — drives the highlight + asserts onCat wiring target
    expect(html).toMatch(/data-active="true"[^>]*>Server</);
  });

  it('omits the hidden npm-dev-server class-proof from the gallery', () => {
    const html = renderToString(() => StartersTab(props));
    expect(html).toContain('data-preset="webpack-dev-server"');
    expect(html).not.toContain('data-preset="npm-dev-server-node-ws"');
    const searched = renderToString(() => StartersTab({ ...props, q: 'npm-dev-server-node-ws' }));
    expect(searched).not.toContain('data-preset="npm-dev-server-node-ws"');
  });

  it('concurrent-same-key fault: blocks starter admission while the owner FIFO is occupied', () => {
    const html = renderToString(() => StartersTab({ ...props, ownerBlocked: true }));
    expect(html).toMatch(/data-preset="real-vite"[^>]*disabled/);
    expect(html).toMatch(/data-preset="express-sqlite"[^>]*disabled/);
    expect(html).toMatch(/class="rf-starters__cat"(?![^>]*disabled)/);
  });
});
