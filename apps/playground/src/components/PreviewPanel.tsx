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
 * Reload (manual and HMR) uses `frame.contentWindow.location.reload()` — the
 * same mechanism as ADR-0017's HMR client — so there's one refresh path.
 */
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

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

export function PreviewPanel(props: {
  initialPort?: number;
  refreshKey?: number;
  onOpenTab?: () => void;
}) {
  const [port, setPort] = createSignal(props.initialPort ?? 3000);
  const [phase, setPhase] = createSignal<Phase>('starting');
  const [retry, setRetry] = createSignal(0);
  let frame: HTMLIFrameElement | undefined;

  const previewUrl = (): string => `/preview/${port()}/`;

  function openTab(): void {
    if (props.onOpenTab) {
      props.onOpenTab();
      return;
    }
    globalThis.window?.open(previewUrl(), '_blank');
  }

  function reload(): void {
    if (phase() === 'live') {
      frame?.contentWindow?.location.reload();
    } else {
      setRetry((n) => n + 1); // Reload doubles as retry before we're live.
    }
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
    props.refreshKey;
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
        frame.src = 'about:blank';
        await new Promise((r) => setTimeout(r, 0));
        if (!alive) return;
        frame.src = url;
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
    <section class="rf-pane" data-testid="preview">
      <div class="rf-pane__chrome">
        <span class="rf-pane__title">Preview</span>
        <PhasePill phase={phase} />
        <span class="rf-preview__url">
          :
          <input
            class="rf-preview__port"
            type="number"
            value={port()}
            min={1}
            max={65535}
            onChange={(e) => setPort(Number.parseInt(e.currentTarget.value, 10) || 3000)}
            aria-label="Preview port"
          />
        </span>
        <div class="rf-pane__tools">
          <button type="button" class="rf-btn rf-btn--ghost" onClick={reload}>
            ↻ Reload
          </button>
        </div>
      </div>
      <div class="rf-pane__body">
        <iframe
          ref={frame}
          class="rf-preview__frame"
          src="about:blank"
          title={`Preview port ${port()}`}
        />
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
    props.phase() === 'live' ? 'live' : props.phase() === 'error' ? 'unavailable' : 'starting…';
  return (
    <span class="rf-preview__status" data-phase={props.phase()}>
      <span class="rf-preview__status-dot" />
      {label()}
    </span>
  );
}
