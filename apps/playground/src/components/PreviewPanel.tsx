/**
 * M10 preview panel — iframe pinned to `/preview/<port>/` for the playground
 * Service Worker to route to the runtime's port registry.
 *
 * Two-step readiness so the pill never lies:
 *   1. Poll `fetch(/preview/<port>/)` until `ok` — proves the server is up and
 *      the SW bridge round-trips a *subresource* request (what M7 e2e exercises).
 *   2. Point the iframe at the route and check the nav actually *committed*
 *      (frame left `about:blank`). A sub-frame nav can abort on commit even
 *      when the subresource fetch succeeds, so report `live` only on a real
 *      document load, `unavailable` otherwise.
 *
 * ADR-0074: under cross-origin isolation (COEP credentialless) the SW routes
 * every request from inside the preview iframe — nav and subresources — to the
 * controlling window owning the port, so the route commits in-frame. The
 * two-step check is kept as an honest safety net for a genuinely-down server.
 *
 * Warm-up budget (ADR-0077): Real Vite installs from npm before serving, so the
 * route can stay unreachable ~20–30 s. Each probe uses a short per-fetch
 * `AbortController` timeout (so a 30 s cross-realm bridge-timeout while the
 * worker isn't serving can't eat the whole budget); the overall deadline spans
 * an npm install, else the panel showed a false `unavailable` before Vite came up.
 *
 * Manual Reload reuses the warm-up/remount path. When HMR is enabled (ADR-0126)
 * file edits are refreshed by the iframe HMR client itself, not by parent
 * snapshot updates. On the Vite 8 template HMR is OFF (ADR-0161): an editor save
 * re-transforms on the next fetch but pushes nothing, and non-editor file changes
 * aren't watched — so seeing an edit needs a manual Reload here.
 */
import {
  type Accessor,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { copyToClipboard } from '../glue/clipboard.ts';
import type { PreviewPortEntry } from '../glue/pty-protocol.ts';
import { Icon } from './icons.tsx';

type Phase = 'starting' | 'live' | 'error';

// Spans a Real Vite npm install + boot (ADR-0076); a down dev server resolves
// to `unavailable`, just later.
const WARMUP_TIMEOUT_MS = 90_000;
const WARMUP_INTERVAL_MS = 400;
// Cap a single probe so a 30 s cross-realm preview-bridge timeout (worker not
// serving yet) doesn't block the poll loop — abort and re-probe instead.
const WARMUP_FETCH_TIMEOUT_MS = 4_000;
const COMMIT_TIMEOUT_MS = 4_000;
const COMMIT_INTERVAL_MS = 200;

// Which port the switcher should show given the live set + current selection
// (ADR-0155). Empty set → keep current (manual-input fallback owns it). Current
// still live → keep it. Otherwise snap to the LAST (most-recently-added) entry,
// so a fresh server auto-selects and a removed one falls back.
export function reconcileSelectedPort(entries: PreviewPortEntry[], current: number): number {
  const last = entries.at(-1);
  if (!last) return current;
  if (last.source === 'preview') return last.port;
  if (entries.some((e) => e.port === current)) return current;
  return last.port;
}

export function PreviewPanel(props: {
  initialPort?: number;
  onOpenTab?: (port: number) => void;
  /** Toast bridge for copy-URL feedback. */
  onNotify?: (message: string, tone: 'error' | 'success') => void;
  /** Live previewable ports (ADR-0155). Non-empty → switcher; empty → manual port input. */
  ports?: Accessor<PreviewPortEntry[]>;
}) {
  const [port, setPort] = createSignal(props.initialPort ?? 3000);
  const [phase, setPhase] = createSignal<Phase>('starting');
  const [retry, setRetry] = createSignal(0);
  const [frameEpoch, setFrameEpoch] = createSignal(0);
  let frame: HTMLIFrameElement | undefined;

  const previewUrl = (): string => `/preview/${port()}/`;
  const frameKey = createMemo(() => ({ epoch: frameEpoch() }));

  const entries = createMemo<PreviewPortEntry[]>(() => props.ports?.() ?? []);

  // Keep the selected port valid against the live set: when ports exist and the
  // current selection isn't one of them, snap to the LAST entry — so a freshly
  // added server auto-selects and a removed one falls back. The warm-up effect +
  // iframe stay keyed off `port()`, so the switch flows through unchanged.
  createEffect(() => {
    const next = reconcileSelectedPort(entries(), port());
    if (next !== port()) setPort(next);
  });

  function openTab(): void {
    if (props.onOpenTab) {
      props.onOpenTab(port());
      return;
    }
    globalThis.window?.open(previewUrl(), '_blank');
  }

  function reload(): void {
    setRetry((n) => n + 1); // Reload doubles as retry before we're live.
  }

  function remountFrame(): void {
    frame = undefined;
    setFrameEpoch((n) => n + 1);
  }

  // The displayed `localhost:<port>` host is virtual (no real TCP listener) —
  // the real route is this origin's SW-routed /preview/<port>/ path. Since
  // ADR-0160 the SW routes a foreign tab's preview requests port-keyed to the
  // playground window that owns the port, so a copied URL loads in a separate
  // tab while that playground tab stays open (the dev server lives in its owner
  // worker); a missing owner renders an honest 503. The ↗ wrapper stays the
  // most robust path (inherits opener context).
  async function copyUrl(): Promise<void> {
    const url = new URL(previewUrl(), globalThis.location?.href).href;
    const ok = await copyToClipboard(url);
    if (ok) props.onNotify?.('Preview URL copied — for a separate tab use ↗', 'success');
    else props.onNotify?.('Could not copy the preview URL', 'error');
  }

  // Did the iframe commit a document at the preview URL? A committed same-origin
  // nav exposes `/preview/<port>/` on its location; an aborted one stays on
  // `about:blank`. A thrown SecurityError means it went cross-origin (committed).
  function committed(): boolean {
    try {
      return (frame?.contentWindow?.location.href ?? 'about:blank').includes(previewUrl());
    } catch {
      return true;
    }
  }

  // (Re)run warm-up on port change or Reload retry. `alive` guards against a
  // stale loop writing state after unmount / a later run.
  createEffect(() => {
    const url = previewUrl();
    retry();
    let alive = true;
    setPhase('starting');
    void (async () => {
      const deadline = Date.now() + WARMUP_TIMEOUT_MS;
      while (alive && Date.now() < deadline) {
        const ac = new AbortController();
        const cap = setTimeout(() => ac.abort(), WARMUP_FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: ac.signal });
          await res.body?.cancel().catch(() => {});
          if (res.ok) break;
        } catch {
          // server/SW not ready, or probe aborted — keep polling
        } finally {
          clearTimeout(cap);
        }
        await new Promise((r) => setTimeout(r, WARMUP_INTERVAL_MS));
      }
      if (!alive) return;
      // Route reachable — load into the frame, then poll for an actual commit
      // (cross-browser: fast where the nav commits, falls through to `error`
      // where the sub-frame nav aborts).
      if (frame) {
        remountFrame();
        await new Promise((r) => setTimeout(r, 0));
        const nextFrame = frame;
        if (!alive || !nextFrame) return;
        nextFrame.src = url;
      }
      const commitDeadline = Date.now() + COMMIT_TIMEOUT_MS;
      let ok = false;
      while (alive && Date.now() < commitDeadline) {
        await new Promise((r) => setTimeout(r, COMMIT_INTERVAL_MS));
        if (committed()) {
          ok = true;
          break;
        }
      }
      if (alive) setPhase(ok ? 'live' : 'error');
    })();
    onCleanup(() => {
      alive = false;
    });
  });

  return (
    <section class="rf-pane rf-card" data-testid="preview">
      {/* Browser-frame chrome: traffic dots · address (lock + host + phase pill) · reload / open. */}
      <div class="rf-preview__chrome">
        <span class="rf-preview__dot" aria-hidden="true" />
        <span class="rf-preview__dot" aria-hidden="true" />
        <span class="rf-preview__dot" aria-hidden="true" />
        <div class="rf-preview__address">
          <button
            type="button"
            class="rf-preview__copy"
            title="Copy preview URL"
            aria-label="Copy preview URL"
            onClick={() => void copyUrl()}
          >
            <Icon name="lock" size={11} />
            <span class="rf-preview__host">localhost:</span>
          </button>
          <Show
            when={entries().length > 0}
            fallback={
              <input
                class="rf-preview__port"
                type="number"
                value={port()}
                min={1}
                max={65535}
                onChange={(e) => setPort(Number.parseInt(e.currentTarget.value, 10) || 3000)}
                aria-label="Preview port"
              />
            }
          >
            <select
              class="rf-preview__switcher"
              aria-label="Preview server"
              value={port()}
              onChange={(e) => setPort(Number(e.currentTarget.value))}
            >
              <For each={entries()}>
                {(e) => <option value={e.port}>{`${e.label} (:${e.port})`}</option>}
              </For>
            </select>
          </Show>
          <PhasePill phase={phase} />
        </div>
        <button
          type="button"
          class="rf-iconbtn"
          title="Reload preview"
          aria-label="Reload preview"
          onClick={reload}
        >
          <Icon name="rotate-ccw" size={14} />
        </button>
        <button
          type="button"
          class="rf-iconbtn"
          title="Open preview in new tab"
          aria-label="Open preview in new tab"
          onClick={openTab}
        >
          <Icon name="external-link" size={14} />
        </button>
      </div>
      <div class="rf-pane__body">
        <Show keyed when={frameKey()}>
          {(_key) => (
            <iframe
              ref={frame}
              class="rf-preview__frame"
              src="about:blank"
              title={`Preview port ${port()}`}
            />
          )}
        </Show>
        {phase() === 'error' && (
          <div class="rf-preview__overlay">
            <p class="rf-preview__overlay-title">Preview couldn't load in-frame</p>
            <p class="rf-preview__overlay-body">
              The dev server is running (the route responds), but the in-page preview frame didn't
              commit. Try{' '}
              <button type="button" class="rf-linkbtn" onClick={reload}>
                Reload
              </button>{' '}
              or open{' '}
              <button type="button" class="rf-linkbtn" onClick={openTab}>
                a new tab
              </button>
              .
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function PhasePill(props: { phase: Accessor<Phase> }) {
  const label = (): string =>
    props.phase() === 'live' ? 'LIVE' : props.phase() === 'error' ? 'OFF' : 'STARTING';
  const title = (): string =>
    props.phase() === 'live'
      ? 'Preview is live'
      : props.phase() === 'error'
        ? 'Preview unavailable — the frame did not commit'
        : 'Waiting for the dev server…';
  return (
    <span class="rf-preview__status" data-phase={props.phase()} title={title()}>
      <span class="rf-preview__status-dot" />
      {label()}
    </span>
  );
}
