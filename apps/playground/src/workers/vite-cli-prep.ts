import { trackKeepalivePromise } from '@riftydev/runtime-js';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import { installEsbuildBridge } from './esbuild-host.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
// TODO(backlog: playground/vite-cli-keepalive-patch-retirement)
const VITE_CLI_KEEPALIVE_NEEDLE = 'this.runMatchedCommand();';
const VITE_CLI_KEEPALIVE_PATCH = `var __riftyAction = this.runMatchedCommand();
      if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.__riftyTrackCliPromise) {
        globalThis.__riftyTrackCliPromise(__riftyAction);
      }`;

declare global {
  // Pins detached async CLI actions (Vite's bundled CAC parse() does not await them).
  // eslint-disable-next-line no-var
  var __riftyTrackCliPromise: ((promise: PromiseLike<unknown>) => void) | undefined;
}

// NOT a shadow-registry shim (those apply at install time, ADR-0188): this
// patches vite's OWN dist/node/cli.js for rifty's runtime lifecycle — the
// keepalive pin (CAC never awaits async actions). Mode-independent: rifty no
// longer touches vite's preview config/CORS. The real CLI loads the user's
// vite.config; a preview option the same-origin bridge cannot honor surfaces at
// its own execution boundary (e.g. net throws on an unsupported proxy target),
// never a pre-scan config guard. Origin/isolation-header shape differences are
// signposted (backlog playground/vite-preview-origin-isolation-signpost), not
// silently forced off.
function installCliActionPatches(root: string): void {
  globalThis.__riftyTrackCliPromise = (promise) => trackKeepalivePromise(promise);
  const fs = syncMirror();
  const path = normalizePath(`${root}/node_modules/vite/dist/node/cli.js`);
  if (!fs.existsSync(path)) return;
  const source = dec.decode(fs.readFileBytesSync(path));
  if (source.includes('__riftyTrackCliPromise')) return;
  if (!source.includes(VITE_CLI_KEEPALIVE_NEEDLE)) {
    throw new Error('vite CLI keepalive patch failed: runMatchedCommand call shape not found');
  }
  fs.writeFileSync(
    path,
    enc.encode(source.replace(VITE_CLI_KEEPALIVE_NEEDLE, VITE_CLI_KEEPALIVE_PATCH)),
  );
}

export async function prepareViteCli(root: string): Promise<void> {
  installCliActionPatches(root);
  installEsbuildBridge();
}

export function binNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function createPreviewScope(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random()}`;
}
