import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Residual source pins for the workspace-owner worker entry. The bulk of the
 * former greps moved to BEHAVIORAL tests (epic playground-testable-core):
 *
 * browser-unit lane (ADR-0196, tests/browser-unit/):
 *   - vfs-write kernel-IPC accept + real-error acks → owner-bridges.spec.ts
 *   - snapshot push on owner mutation + serveVfsWrites bridge + OPFS
 *     initBackend/persistence + hidden-empty boot (no README, scratch:null)
 *     → owner-publish-and-persistence.spec.ts
 *   - npm-run through the real shell, no owner `vite` command (honest 127),
 *     node-cli dev wrapper lines, beforeRun deps gate + restore progress,
 *     seedTemplateNodeModulesFiles post-restore → owner-shell-routing.spec.ts
 *   - starter boot seeding, scratch index synthesis (reconcileOwnerIndexAtBoot),
 *     archive/index/file-read bridges answering → owner-boot-modes.spec.ts
 *
 * e2e:
 *   - editor write → remote fs.watch → child HMR → preview update → m7-preview-sw.spec.ts
 *   - real .bin/vite dispatch + visible config → vite-command-honesty.spec.ts
 *   - preview mode (stock args, SW-stamped Host) → vite7-build-preview.spec.ts
 *   - uniform bin/preview-registry lifecycle → generic-dev-server-lifecycle,
 *     node-command, socket-lab/hono-api/koa-api specs
 *   - node-cli preset lifecycle → cli-report.spec.ts
 *   - TS-LSP dependency gating → ts-language-service.spec.ts
 *   - restore never wipes user files → starter-file-edit-survives-reload,
 *     project-switch specs
 *   - generated-baseline absorb into Initial commit → project-management.spec.ts
 *   - index reset-refresh hook (re-seed republishes) → project-management.spec.ts
 *   - dev-boot clean gating → dev-boot-clean.test.ts (decision fn) +
 *     project-switch.spec.ts (full switch)
 */
const source = readFileSync(
  fileURLToPath(new URL('./real-vite-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('residual source pins', () => {
  it('bin lifecycle stays uniform — ZERO vite-name dispatch in the owner bootstrap', () => {
    // residual source pin: the per-bin-name dispatch class regresses silently
    // (webpack-dev-server et al. keep working through generic paths in e2e).
    // Vite wrapper/args/file-watch behavior is covered by the browser contract
    // and HMR e2e; keep only the pre-existing generic-dispatch pins here.
    expect(source).not.toContain("!== 'vite'");
    expect(source).not.toContain("binNameOf(req.shimPath) === 'vite'");
    expect(source).not.toContain('RIFTY_VITE_CLI_PORT');
    expect(source).not.toContain('VITE_DEFAULT_DEV_PORT');
  });

  it('dev-config ack never awaits the deps restore (echo-behind-download regression)', () => {
    // residual source pin: the GATE half is behavioral (browser-unit
    // owner-shell-routing.spec.ts); the ack-latency half (dead-silent `$ <line>`
    // echo behind a multi-MB snapshot download) has no deterministic seam.
    expect(source).not.toContain('return devConfigReady');
    expect(source).not.toContain('void devConfigReady.then(() => server.handleFrame(frame))');
  });

  it('calls builtin registrars explicitly so production bundling cannot drop them', () => {
    // residual source pin: prod-bundle chunk-drop guard (the PROD dual-copy
    // class); every test lane here runs the dev server, never the prod bundle.
    expect(source).toContain('registerNetBuiltins()');
    expect(source).toContain('registerSqliteBuiltin()');
  });

  it('roots the owner-realm process.cwd at the project root', () => {
    // residual source pin: owner-realm process.cwd has no page-observable seam
    // (child realms re-assert their own cwd); owner-resident tooling reads it.
    expect(source).toContain('setProcessCwd(cfg.root)');
  });

  it('publishes owner readiness only after IPC handlers and workspace bridges are served', () => {
    // residual source pin: the ORDER is not page-observable — an early-ready
    // mutation stayed green (the page's post-ready round-trip outlasts the
    // owner's synchronous bridge registration). owner-boot-modes.spec.ts pins
    // the served bridges themselves; this pins the order.
    const onMessageAt = source.indexOf('kernelIpc.onMessage?.((message) => {');
    const bridgeAt = source.indexOf('const tearIndexBridge = serveProjectIndex(');
    const readyAt = source.indexOf(
      "kernelIpc.send?.({ type: 'rifty:workspace-owner-ready', port })",
    );
    expect(onMessageAt).toBeGreaterThan(-1);
    expect(bridgeAt).toBeGreaterThan(onMessageAt);
    expect(readyAt).toBeGreaterThan(bridgeAt);
  });
});
