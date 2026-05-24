import type { CapabilityCheck } from '@rifty/runtime-js/env/capabilities';

export function CapabilitiesPanel(props: { check: CapabilityCheck }) {
  return (
    <div style={{ padding: '32px', 'max-width': '700px' }}>
      <h2 style={{ margin: '0 0 12px' }}>Browser capabilities missing</h2>
      <p>
        rifty requires cross-origin isolation, Web Workers, and Service Workers. Without these
        features the runtime can't boot.
      </p>
      <pre
        style={{
          background: '#161922',
          padding: '12px',
          'border-radius': '6px',
          overflow: 'auto',
          'font-size': '13px',
        }}
      >
        {props.check.summary}
      </pre>
      <p>
        If you're running locally with <code>pnpm dev</code>, the Vite server sets the necessary
        COOP/COEP headers — try reloading. In production, ensure your host serves
        <code> Cross-Origin-Opener-Policy: same-origin </code>and
        <code> Cross-Origin-Embedder-Policy: credentialless</code>.
      </p>
    </div>
  );
}
