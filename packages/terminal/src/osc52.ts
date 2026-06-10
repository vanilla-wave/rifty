const ESC = '\\x1b';
const BEL = '\\x07';
const OSC52_RE = new RegExp(`${ESC}\\]52;([^;]*);([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`, 'g');
const MAX_OSC52_BASE64 = 1024 * 1024;

export interface Osc52Write {
  readonly text: string;
}

export interface Osc52Result {
  readonly text: string;
  readonly writes: readonly Osc52Write[];
}

function decodeBase64Utf8(payload: string): string | null {
  if (payload.length === 0 || payload.length > MAX_OSC52_BASE64) return null;
  try {
    const binary = globalThis.atob(payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isClipboardTarget(target: string): boolean {
  return target === '' || target === 'c';
}

export function extractOsc52Writes(input: string): Osc52Result {
  const writes: Osc52Write[] = [];
  const text = input.replace(OSC52_RE, (_sequence, target: string, payload: string) => {
    if (!isClipboardTarget(target)) return '';
    if (payload === '?') return '';
    const decoded = decodeBase64Utf8(payload);
    if (decoded != null) writes.push({ text: decoded });
    return '';
  });
  return { text, writes };
}
