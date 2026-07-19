import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'solid-js/web';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type PreviewPanelEntry,
  PreviewPanel,
  reconcileSelectedPort,
} from './PreviewPanel.tsx';

// Read ONLY for the two residual client-only pins below (keyed remount +
// no-location.reload) — everything else is behavioral or tsc-gated.
const panelSource = readFileSync(
  fileURLToPath(new URL('./PreviewPanel.tsx', import.meta.url)),
  'utf8',
);

const TWO_PORTS: PreviewPanelEntry[] = [
  {
    port: 5174,
    url: '/preview/5174/',
    label: 'npm run dev',
  },
  { port: 3000, url: '/preview/3000/', label: 'node :3000' },
];
const WITH_PROD_PREVIEW: PreviewPanelEntry[] = [
  ...TWO_PORTS,
  {
    port: 4173,
    url: '/preview/4173/',
    label: 'vite preview',
  },
];

describe('PreviewPanel refresh contract', () => {
  it('does not accept a parent snapshot refresh key', () => {
    // ADR-0126 — preview reloads are HMR-client-driven; snapshot reload removed.
    // tsc-gated (playground tsconfig covers tests); the exact semantic URL
    // routing is pinned in preview-panel-core.test.ts.
    expectTypeOf(PreviewPanel).parameter(0).not.toHaveProperty('refreshKey');
  });

  it('passes the selected semantic preview URL to the open-tab callback', () => {
    // ADR-0278: the semantic registry URL, not a caller-reconstructed port
    // route, crosses the UI callback.
    expectTypeOf(PreviewPanel)
      .parameter(0)
      .toMatchObjectType<{ onOpenTab?: (url: string) => void }>();
  });

  it('recreates the iframe before preview navigation so the SW controls the document', () => {
    // Behavioral half (preview-panel-core.test.ts): warm-up navigation remounts
    // FIRST and writes src only into the fresh frame.
    // residual source pin: keyed <Show> reconciliation is client-only — node
    // vitest runs the solid SERVER runtime (renders once, effects no-op), so
    // "epoch bump recreates the iframe element" is unobservable here. A
    // non-keyed <Show> would keep the stale pre-SW frame and never re-ref it.
    expect(panelSource).toMatch(/<Show keyed when=\{frameKey\(\)\}>/);
  });

  it('routes manual reload through the warm-up remount path', () => {
    // Behavioral half (preview-panel-core.test.ts): every warm-up run navigates
    // via a remounted frame — there is no other reload mechanism in the core.
    // residual source pin: Reload = retry-signal bump re-running the warm-up
    // createEffect — client-only wiring (server runtime effects no-op). A
    // direct iframe location.reload() would bypass the SW-controlled remount.
    expect(panelSource).not.toContain('location.reload');
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

  it('offers no manual route or preview actions before the registry publishes an entry', () => {
    const empty = renderToString(() => PreviewPanel({ ports: () => [] }));
    expect(empty).not.toContain('class="rf-preview__port"');
    expect(empty).not.toContain('class="rf-preview__switcher"');
    expect(empty).not.toContain('class="rf-preview__frame"');
    expect(empty).not.toContain('aria-label="Copy preview URL"');
    expect(empty).not.toContain('aria-label="Reload preview"');
    expect(empty).not.toContain('aria-label="Open preview in new tab"');
    expect(empty).toContain('data-testid="preview-empty"');

    const none = renderToString(() => PreviewPanel({}));
    expect(none).not.toContain('class="rf-preview__port"');
    expect(none).not.toContain('class="rf-preview__switcher"');
    expect(none).not.toContain('class="rf-preview__frame"');
    expect(none).toContain('data-testid="preview-empty"');
  });
});

describe('reconcileSelectedPort (auto-select newly appended)', () => {
  const known = (ports: readonly number[]): ReadonlySet<number> => new Set(ports);

  it('keeps the current selection when it is still live and nothing new appeared', () => {
    expect(reconcileSelectedPort(TWO_PORTS, 5174, known([5174, 3000]))).toBe(5174);
    expect(reconcileSelectedPort(TWO_PORTS, 3000, known([5174, 3000]))).toBe(3000);
  });

  it('snaps to a NEWLY appended server — generic, any source (was: preview-source only)', () => {
    // `vite preview` appended :4173 → auto-select it…
    expect(reconcileSelectedPort(WITH_PROD_PREVIEW, 5174, known([5174, 3000]))).toBe(4173);
    // …and a freshly started node/bin server auto-selects the same way.
    expect(reconcileSelectedPort(TWO_PORTS, 5174, known([5174]))).toBe(3000);
  });

  it('does not re-snap to an already-known last entry', () => {
    expect(reconcileSelectedPort(WITH_PROD_PREVIEW, 5174, known([5174, 3000, 4173]))).toBe(5174);
  });

  it('snaps to the LAST entry when the current selection is gone', () => {
    expect(reconcileSelectedPort(TWO_PORTS, 9999, known([5174, 3000]))).toBe(3000);
    expect(reconcileSelectedPort(TWO_PORTS.toReversed(), 9999, known([5174, 3000]))).toBe(5174);
  });

  it('leaves the current selection untouched when the set is empty', () => {
    expect(reconcileSelectedPort([], 8080, known([]))).toBe(8080);
  });
});
