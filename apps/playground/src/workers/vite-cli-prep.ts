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
// signposted in the preview UI (PreviewPanel /preview/ chip + COEP/CORP tooltip), not
// silently forced off.
//
// The patch target derives from the EXECUTED shim (`argv[1]` =
// `<dir>/node_modules/.bin/vite` → `<dir>/node_modules/vite/dist/node/cli.js`),
// never from cwd: resolveBin walks ANCESTOR node_modules (hoisting), so a
// cwd-anchored lookup silently skipped the hoisted vite → CAC exited early →
// dev server died with no signal (PR#125, false-fallback). Silent skip remains
// ONLY when the derived cli.js is absent (a foreign bin merely named `vite`).
function installCliActionPatches(binPath: string): void {
  globalThis.__riftyTrackCliPromise = (promise) => trackKeepalivePromise(promise);
  const fs = syncMirror();
  const path = normalizePath(`${binPath}/../../vite/dist/node/cli.js`);
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

/** `binPath` = the executed `.bin/vite` shim path (`process.argv[1]`), NOT cwd. */
export async function prepareViteCli(binPath: string): Promise<void> {
  installCliActionPatches(binPath);
  installEsbuildBridge();
}

export function binNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function createPreviewScope(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random()}`;
}
