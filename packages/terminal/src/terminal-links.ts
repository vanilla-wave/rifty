import type { ILinkHandler } from '@xterm/xterm';

export interface TerminalWebLinksOptions {
  /** Require Ctrl/Cmd when opening a detected URL. Defaults to true. */
  readonly requireModifier?: boolean;
  /** Host-owned opener. Defaults to `window.open(uri, '_blank', 'noopener,noreferrer')`. */
  readonly onLink?: (uri: string, event: MouseEvent) => void;
}

export function webLinksOptions(
  webLinks: boolean | TerminalWebLinksOptions | undefined,
): TerminalWebLinksOptions {
  return typeof webLinks === 'object' ? webLinks : {};
}

export function shouldOpenTerminalLink(
  event: MouseEvent,
  options: TerminalWebLinksOptions,
): boolean {
  return !(options.requireModifier ?? true) || event.ctrlKey || event.metaKey;
}

export function openTerminalLink(
  uri: string,
  event: MouseEvent,
  options: TerminalWebLinksOptions,
): void {
  if (!shouldOpenTerminalLink(event, options)) return;
  if (options.onLink) {
    options.onLink(uri, event);
    return;
  }
  globalThis.window?.open(uri, '_blank', 'noopener,noreferrer');
}

export function createOsc8LinkHandler(
  webLinks: boolean | TerminalWebLinksOptions | undefined,
): ILinkHandler | null {
  if (webLinks === false) return null;
  const options = webLinksOptions(webLinks);
  return {
    allowNonHttpProtocols: Boolean(options.onLink),
    activate: (event, text) => openTerminalLink(text, event, options),
  };
}
