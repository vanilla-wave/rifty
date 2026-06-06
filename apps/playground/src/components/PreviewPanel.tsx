/**
 * M10 preview panel — an iframe pinned to `/preview/<port>/` for the playground
 * Service Worker to route through to the runtime's port registry. Includes a
 * port input + reload button + "open in new tab" link + a live status pill.
 *
 * Two-step readiness, so the pill never lies:
 *   1. Poll `fetch(/preview/<port>/)` until it answers `ok`. That proves the
 *      server is up and the SW bridge round-trips a *subresource* request
 *      (the path the M7 e2e exercises).
 *   2. Point the iframe at the route and check whether the navigation actually
 *      *committed* (the frame's window left `about:blank`). A sub-frame
 *      navigation can be aborted on commit even when the subresource fetch
 *      succeeds — see the known limitation below — so we report `live` only
 *      when the document truly loaded, and `unavailable` otherwise.
 *
 * Resolved by ADR-0074: under a cross-origin-isolated page (COEP
 * credentialless) the SW now routes every request that originates inside the
 * preview iframe — the navigation and its subresources — to the controlling
 * window that owns the port. So `/preview/<port>/` commits in-frame and the
 * app's JS boots. The two-step poll-then-check-commit below is kept as an
 * honest safety net for a genuinely-down server (the route stays unreachable,
 * the frame stays on `about:blank`, and we report `unavailable`).
 *
 * Warm-up budget (ADR-0077): Real Vite installs from npm before it can serve,
 * so the route can stay unreachable for ~20–30 s. Each warm-up probe uses a
 * short per-fetch `AbortController` timeout (so a 30 s cross-realm bridge-
 * timeout while the worker isn't serving yet can't eat the whole budget) and
 * the overall deadline is generous enough to span an npm install — otherwise
 * the panel gave up before Vite came up and showed a false `unavailable`.
 *
 * Reload (manual and HMR) uses `frame.contentWindow.location.reload()` — the
 * same mechanism ADR-0017's HMR client uses — so there's one refresh path.
 */
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

type Phase = 'starting' | 'live' | 'error';

// Generous enough to span a Real Vite npm install + boot (ADR-0076); a
// genuinely-down dev server still resolves to `unavailable`, just later.
const WARMUP_TIMEOUT_MS = 90_000;
const WARMUP_INTERVAL_MS = 400;
// Cap a single probe so a 30 s cross-realm preview-bridge timeout (worker not
// serving yet) doesn't block the poll loop — abort and re-probe instead.
const WARMUP_FETCH_TIMEOUT_MS = 4_000;
const COMMIT_TIMEOUT_MS = 4_000;
const COMMIT_INTERVAL_MS = 200;

export function PreviewPanel(props: { initialPort?: number }) {
  const [port, setPort] = createSignal(props.initialPort ?? 3000);
  const [phase, setPhase] = createSignal<Phase>('starting');
  const [retry, setRetry] = createSignal(0);
  let frame: HTMLIFrameElement | undefined;

  const previewUrl = (): string => `/preview/${port()}/`;

  function reload(): void {
    if (phase() === 'live') {
      frame?.contentWindow?.location.reload();
    } else {
      setRetry((n) => n + 1); // Reload doubles as "retry" before we're live.
    }
  }

  // Did the iframe actually commit a document at the preview URL? A same-origin
  // committed nav exposes `/preview/<port>/` on its window location; an aborted
  // one stays on `about:blank`. A thrown SecurityError would mean it navigated
  // cross-origin (treat as committed).
  function committed(): boolean {
    try {
      return (frame?.contentWindow?.location.href ?? 'about:blank').includes(previewUrl());
    } catch {
      return true;
    }
  }

  // (Re)run the warm-up whenever the port changes or Reload retries. `alive`
  // guards against a stale loop writing state after unmount / a later run.
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
          // server/SW not ready yet, or the probe was aborted — keep polling
        } finally {
          clearTimeout(cap);
        }
        await new Promise((r) => setTimeout(r, WARMUP_INTERVAL_MS));
      }
      if (!alive) return;
      // Route is reachable — load it into the frame, then poll for an actual
      // commit (robust across browsers: fast where the nav commits, falls
      // through to `error` where the sub-frame navigation aborts).
      if (frame) frame.src = url;
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
          <a class="rf-preview__link" href={previewUrl()} target="_blank" rel="noopener noreferrer">
            ↗ new tab
          </a>
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
              <a href={previewUrl()} target="_blank" rel="noopener noreferrer">
                ↗ a new tab
              </a>
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
