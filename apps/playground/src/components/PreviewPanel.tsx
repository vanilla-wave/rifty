/**
 * M10 preview panel — an iframe pinned to `/preview/<port>/` for the playground
 * Service Worker to route through to the runtime's port registry. Includes a
 * port input + reload button + "open in new tab" link.
 */
import { createSignal } from 'solid-js';

export function PreviewPanel(props: { initialPort?: number }) {
  const [port, setPort] = createSignal(props.initialPort ?? 3000);
  const [version, setVersion] = createSignal(0);
  let frame: HTMLIFrameElement | undefined;

  const previewUrl = (): string => `/preview/${port()}/?v=${version()}`;

  function reload(): void {
    setVersion(version() + 1);
  }

  return (
    <div
      style={{
        display: 'grid',
        'grid-template-rows': 'auto 1fr',
        height: '100%',
        'border-left': '1px solid #232735',
        background: '#0f1115',
      }}
      data-testid="preview"
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          padding: '6px 10px',
          background: '#13161f',
          'border-bottom': '1px solid #232735',
          color: '#cbd0dd',
          'font-size': '12px',
        }}
      >
        <span style={{ color: '#8a93a3' }}>Preview</span>
        <span style={{ color: '#5a6172' }}>:</span>
        <input
          type="number"
          value={port()}
          min={1}
          max={65535}
          onChange={(e) => setPort(Number.parseInt(e.currentTarget.value, 10) || 3000)}
          style={{
            width: '70px',
            background: '#0f1115',
            color: '#e6e6e6',
            border: '1px solid #2a3142',
            'border-radius': '3px',
            padding: '2px 4px',
            'font-family': 'inherit',
            'font-size': '12px',
          }}
        />
        <button
          type="button"
          onClick={reload}
          style={{
            background: '#1f2533',
            color: '#e6e6e6',
            border: '1px solid #2a3142',
            padding: '2px 8px',
            'border-radius': '3px',
            cursor: 'pointer',
            'font-family': 'inherit',
            'font-size': '12px',
          }}
        >
          Reload
        </button>
        <a
          href={previewUrl()}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            'margin-left': 'auto',
            color: '#8a93a3',
            'text-decoration': 'none',
          }}
        >
          ↗ new tab
        </a>
      </div>
      <iframe
        ref={frame}
        src={previewUrl()}
        title={`Preview port ${port()}`}
        style={{ border: 'none', width: '100%', height: '100%', background: '#fff' }}
      />
    </div>
  );
}
