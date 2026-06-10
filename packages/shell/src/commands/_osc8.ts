import { normalizePath } from '@riftydev/vfs';
import type { CommandContext } from '../types.ts';

const OSC8_OPEN = '\x1b]8;;';
const OSC8_CLOSE = '\x1b]8;;\x07';
const BEL = '\x07';

function fileUri(path: string): string {
  const encodedPath = normalizePath(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `file://${encodedPath}`;
}

export function osc8Link(uri: string, label: string): string {
  return `${OSC8_OPEN}${uri}${BEL}${label}${OSC8_CLOSE}`;
}

export function osc8FileLink(path: string, label: string, ctx: CommandContext): string {
  if (!ctx.isTTY) return label;
  return osc8Link(fileUri(path), label);
}
