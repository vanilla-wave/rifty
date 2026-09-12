import type { AgentPreview } from './types.ts';

export function createBrowserAgentPreview(options: {
  readonly url: () => string;
  readonly frame?: () => HTMLIFrameElement;
}): AgentPreview {
  const element = (selector: string) => {
    const document = options.frame?.().contentDocument;
    if (!document)
      throw new Error('Preview DOM unavailable; host must supply an accessible same-origin frame');
    const selected = document.querySelector(selector);
    if (!selected) throw new Error(`Preview selector did not match: ${selector}`);
    return selected;
  };
  return {
    async fetch(path, signal) {
      const base = new URL(options.url());
      const url = new URL(path.replace(/^\/+/, ''), base);
      if (
        url.origin !== base.origin ||
        !url.pathname.startsWith(
          base.pathname.endsWith('/')
            ? base.pathname
            : base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1),
        )
      ) {
        throw new Error('Preview path must remain inside the supplied preview URL');
      }
      const response = await fetch(url, { signal });
      return { status: response.status, body: await response.text() };
    },
    ...(options.frame
      ? {
          async query(selector: string) {
            const selected = element(selector);
            return {
              tag: selected.tagName.toLowerCase(),
              text: selected.textContent,
              html: selected.outerHTML,
            };
          },
          async click(selector: string) {
            const selected = element(selector);
            if (!('click' in selected) || typeof selected.click !== 'function')
              throw new Error(`Preview element cannot click: ${selector}`);
            selected.click();
            return { clicked: selector };
          },
          async type(selector: string, value: string) {
            const selected = element(selector);
            const realm = selected.ownerDocument.defaultView;
            if (!realm) throw new Error('Preview document is detached');
            const constructors = realm as unknown as {
              HTMLInputElement: typeof HTMLInputElement;
              HTMLTextAreaElement: typeof HTMLTextAreaElement;
              Event: typeof Event;
            };
            const prototype =
              selected.tagName === 'INPUT'
                ? constructors.HTMLInputElement.prototype
                : selected.tagName === 'TEXTAREA'
                  ? constructors.HTMLTextAreaElement.prototype
                  : null;
            const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (!setter) throw new Error(`Preview element is not a text input: ${selector}`);
            setter.call(selected, value);
            selected.dispatchEvent(new constructors.Event('input', { bubbles: true }));
            selected.dispatchEvent(new constructors.Event('change', { bubbles: true }));
            return { typed: selector };
          },
        }
      : {}),
  };
}
