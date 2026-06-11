import type { CapabilityCheck } from '@riftydev/runtime-js/env/capabilities';

export function CapabilitiesPanel(props: { check: CapabilityCheck }) {
  return (
    <div class="rf-caps">
      <h2>Browser capabilities missing</h2>
      <p>
        rifty requires cross-origin isolation, Web Workers, and Service Workers. Without these
        features the runtime can't boot.
      </p>
      <pre>{props.check.summary}</pre>
      <p>
        If you're running locally with <code>pnpm dev</code>, the Vite server sets the necessary
        COOP/COEP headers — try reloading. In production, ensure your host serves
        <code> Cross-Origin-Opener-Policy: same-origin </code>and
        <code> Cross-Origin-Embedder-Policy: credentialless</code>. If rifty is embedded in another
        app, the parent page must be cross-origin isolated and the iframe must include{' '}
        <code>allow="cross-origin-isolated"</code>.
      </p>
    </div>
  );
}
