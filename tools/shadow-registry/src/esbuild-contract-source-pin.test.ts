import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('esbuild-wasm/package.json');
const packageRoot = dirname(packagePath);

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Text(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

interface SnapshotFile {
  readonly path: string;
  readonly encoding: string;
  readonly content: string;
}

interface ViteSnapshot {
  readonly nodeModules: { readonly files: readonly SnapshotFile[] };
}

function snapshotFile(snapshot: ViteSnapshot, path: string): string {
  const file = snapshot.nodeModules.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Vite contract snapshot missing ${path}`);
  if (file.encoding !== 'base64') {
    throw new Error(`Vite contract snapshot ${path} uses ${file.encoding}, expected base64`);
  }
  return Buffer.from(file.content, 'base64').toString('utf8');
}

describe('esbuild-wasm 0.28.0 source pin', () => {
  it('pins the exact upstream browser CJS client and Go WASM bytes from ADR-0226', () => {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      readonly version?: unknown;
    };
    expect(manifest.version).toBe('0.28.0');
    expect(sha256(join(packageRoot, 'lib/browser.js'))).toBe(
      'b882a5ffb3bf170c0d8f40c0832cc5dca00830400314bb9455dea5d6f58c2a10',
    );
    expect(sha256(join(packageRoot, 'esbuild.wasm'))).toBe(
      '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b',
    );
  });
});

describe('Vite 7.3.6 consumer pin', () => {
  it('pins action imports, requested esbuild range, and CAC no-action split', () => {
    const snapshot = JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            '../../../apps/playground/public/snapshots/vite-node-modules.json.gz',
            import.meta.url,
          ),
        ),
      ).toString('utf8'),
    ) as ViteSnapshot;
    const manifest = JSON.parse(snapshotFile(snapshot, 'vite/package.json')) as {
      readonly version?: unknown;
      readonly dependencies?: Readonly<Record<string, unknown>>;
    };
    const cli = snapshotFile(snapshot, 'vite/dist/node/cli.js');
    const config = snapshotFile(snapshot, 'vite/dist/node/chunks/config.js');

    expect(manifest.version).toBe('7.3.6');
    expect(manifest.dependencies?.esbuild).toBe('^0.27.0 || ^0.28.0');
    expect(sha256Text(cli)).toBe(
      '6b9001816eb5fb0979cbe380ed2116db93e315ff22ebf7fe55a4fc60458fa067',
    );
    for (const anchor of [
      'cli.command("[root]", "start dev server").alias("serve").alias("dev")',
      'const { createServer } = await import("./chunks/server.js");',
      'cli.command("build [root]", "build for production")',
      'const { createBuilder } = await import("./chunks/build.js");',
      'cli.command("preview [root]", "locally preview production build")',
      'const { preview } = await import("./chunks/preview.js");',
      'cli.command("optimize [root]", "pre-bundle dependencies',
      'const { resolveConfig } = await import("./chunks/config2.js");',
      'const { optimizeDeps } = await import("./chunks/optimizer.js");',
    ]) {
      expect(cli, anchor).toContain(anchor);
    }
    expect(config).toContain(
      'import esbuild, { build, formatMessages, transform } from "esbuild";',
    );
    for (const path of [
      'vite/dist/node/chunks/server.js',
      'vite/dist/node/chunks/build.js',
      'vite/dist/node/chunks/preview.js',
      'vite/dist/node/chunks/config2.js',
      'vite/dist/node/chunks/optimizer.js',
    ]) {
      expect(snapshotFile(snapshot, path), path).toContain('from "./config.js"');
    }
    expect(cli).toContain('if (this.options.help && this.showHelpOnExit) {');
    expect(cli).toContain(
      'if (this.options.version && this.showVersionOnExit && this.matchedCommandName == null) {',
    );
  });
});
