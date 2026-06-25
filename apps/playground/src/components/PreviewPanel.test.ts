import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import type { PreviewPortEntry } from '../glue/pty-protocol.ts';
import { PreviewPanel, reconcileSelectedPort } from './PreviewPanel.tsx';

const source = readFileSync(fileURLToPath(new URL('./PreviewPanel.tsx', import.meta.url)), 'utf8');

const TWO_PORTS: PreviewPortEntry[] = [
  {
    port: 5174,
    url: '/preview/5174/',
    label: 'npm run dev',
    source: 'dev-server',
    sid: 'dev-server',
  },
  { port: 3000, url: '/preview/3000/', label: 'node :3000', source: 'node', sid: 's1' },
];
const WITH_PROD_PREVIEW: PreviewPortEntry[] = [
  ...TWO_PORTS,
  {
    port: 4173,
    url: '/preview/4173/',
    label: 'vite preview',
    source: 'preview',
    sid: 'preview',
  },
];

describe('PreviewPanel refresh contract', () => {
  it('does not accept a parent snapshot refresh key', () => {
    // ADR-0126 — preview reloads are HMR-client-driven; snapshot reload removed.
    expect(source).not.toContain('refreshKey?: number');
    expect(source).not.toContain('props.refreshKey;');
    expect(source).not.toContain('?rf=');
  });

  it('passes the manually selected preview port to the open-tab callback', () => {
    expect(source).toContain('onOpenTab?: (port: number) => void');
    expect(source).toContain('props.onOpenTab(port());');
  });

  it('recreates the iframe before preview navigation so the SW controls the document', () => {
    expect(source).toContain('frameEpoch');
    expect(source).toContain('setFrameEpoch((n) => n + 1)');
    expect(source).toContain('keyed');
  });
});

describe('PreviewPanel port switcher (ADR-0155)', () => {
  it('renders a <select> switcher with one option per live port', () => {
    const html = renderToString(() => PreviewPanel({ ports: () => TWO_PORTS }));
    expect(html).toContain('class="rf-preview__switcher"');
    expect(html).toContain('aria-label="Preview server"');
    const options = html.match(/<option[^>]*value="\d+"/g) ?? [];
    expect(options).toHaveLength(2);
    expect(html).toContain('npm run dev (:5174)');
    expect(html).toContain('node :3000 (:3000)');
  });

  it('defaults the selection to the LAST entry (most-recently-added)', () => {
    const html = renderToString(() => PreviewPanel({ ports: () => TWO_PORTS }));
    // Switcher value + iframe both track the last entry (port 3000).
    expect(html).toMatch(/class="rf-preview__switcher"[^>]*value="3000"/);
    expect(html).toContain('title="Preview port 3000"');
    expect(html).not.toContain('title="Preview port 5174"');
  });

  it('drives the previewed port/url from the selected entry', () => {
    // The selected port flows into the warm-up effect + iframe unchanged: with
    // :5174 selected, the switcher value and the iframe URL both track it.
    // (auto-select-last is an effect-time reconcile — covered as a unit below.)
    const html = renderToString(() => PreviewPanel({ initialPort: 5174, ports: () => TWO_PORTS }));
    expect(html).toMatch(/class="rf-preview__switcher"[^>]*value="5174"/);
    expect(html).toContain('title="Preview port 5174"');
  });

  // onChange→setPort wiring is covered behaviorally: the SSR render asserts the
  // <select class="rf-preview__switcher"> exists with value tracking the selection,
  // reconcileSelectedPort (below) covers the selection logic, and
  // tests/e2e/node-command.spec.ts (selectOption → /preview/<port>/) covers the live
  // onChange→setPort→iframe path. A source-grep of the exact handler string was
  // dropped (ADR-0157 review C8) — it broke on cosmetic rewrites with no behavior change.

  it('falls back to the manual port <input> when there are no known ports', () => {
    const empty = renderToString(() => PreviewPanel({ ports: () => [] }));
    expect(empty).toContain('class="rf-preview__port"');
    expect(empty).not.toContain('class="rf-preview__switcher"');

    const none = renderToString(() => PreviewPanel({}));
    expect(none).toContain('class="rf-preview__port"');
    expect(none).not.toContain('class="rf-preview__switcher"');
  });
});

describe('reconcileSelectedPort (auto-select-last)', () => {
  it('keeps the current selection when it is still live', () => {
    expect(reconcileSelectedPort(TWO_PORTS, 5174)).toBe(5174);
    expect(reconcileSelectedPort(TWO_PORTS, 3000)).toBe(3000);
  });

  it('snaps to a newly added production preview even while the dev server is live', () => {
    expect(reconcileSelectedPort(WITH_PROD_PREVIEW, 5174)).toBe(4173);
  });

  it('snaps to the LAST entry when the current selection is gone', () => {
    expect(reconcileSelectedPort(TWO_PORTS, 9999)).toBe(3000);
    expect(reconcileSelectedPort(TWO_PORTS.toReversed(), 9999)).toBe(5174);
  });

  it('leaves the current selection untouched when the set is empty', () => {
    expect(reconcileSelectedPort([], 8080)).toBe(8080);
  });
});
