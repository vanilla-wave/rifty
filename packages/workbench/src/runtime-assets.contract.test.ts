import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workbenchRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = resolve(workbenchRoot, 'dist/runtime');

const RUNTIME_SCRIPTS = [
  'owner-worker.js',
  'kernel-worker.js',
  'node-worker.js',
  'dev-server-worker.js',
  'typescript-worker.js',
  'no-coi-toolchain-worker.js',
  'sw.js',
] as const;

const RUNTIME_WASM = ['sqlite.wasm', 'quickjs.wasm'] as const;

const REQUIRED_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Service-Worker-Allowed': '/',
} as const;

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const MESSAGE_LISTENER = /addEventListener\(\s*['"]message['"]/;
const SIBLING_QUICKJS_URL = /new URL\(\s*['"]\.\/quickjs\.wasm['"]\s*,\s*import\.meta\.url\s*\)/;

interface RuntimeManifest {
  readonly files: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
}

interface PublishedRuntime {
  readonly root: string;
  readonly manifest: RuntimeManifest;
}

function missingAssetMessage(name: string): string {
  return `copyable Workbench runtime asset ${name} is missing under dist/runtime/; run pnpm build:libs`;
}

function readPublishedRuntime(): PublishedRuntime {
  const manifestPath = resolve(runtimeRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(missingAssetMessage('manifest.json'));
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
  for (const file of manifest.files) {
    if (!existsSync(resolve(runtimeRoot, file))) {
      throw new Error(missingAssetMessage(file));
    }
  }
  return { root: runtimeRoot, manifest };
}

function scriptSource(root: string, name: string): string {
  const path = resolve(root, name);
  if (!existsSync(path)) {
    throw new Error(missingAssetMessage(name));
  }
  return readFileSync(path, 'utf8');
}

async function fetchCopyAssets(
  root: string,
  omitted: string,
  present: string,
): Promise<{ readonly missing: number; readonly present: number }> {
  const server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '/').replace(/^\//u, ''));
    const path = join(root, name);
    if (!existsSync(path)) {
      response.statusCode = 404;
      response.end('Not Found');
      return;
    }
    response.end(readFileSync(path));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('incomplete-copy probe server has no TCP address');
  }
  const origin = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    const [missing, found] = await Promise.all([
      fetch(`${origin}/${omitted}`),
      fetch(`${origin}/${present}`),
    ]);
    return { missing: missing.status, present: found.status };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withIncompleteCopy(
  omit: string,
  body: (incompleteRoot: string) => Promise<void>,
): Promise<void> {
  const published = readPublishedRuntime();
  expect(published.manifest.files).toContain(omit);
  const incompleteRoot = mkdtempSync(join(tmpdir(), 'rifty-runtime-incomplete-'));
  try {
    cpSync(published.root, incompleteRoot, { recursive: true });
    unlinkSync(join(incompleteRoot, omit));
    await body(incompleteRoot);
  } finally {
    rmSync(incompleteRoot, { recursive: true, force: true });
  }
}

describe('copyable Workbench runtime assets', () => {
  it('publishes a bundled runtime closure without @riftydev imports', () => {
    const published = readPublishedRuntime();
    expect(published.manifest.files).toEqual(
      expect.arrayContaining([...RUNTIME_SCRIPTS, ...RUNTIME_WASM]),
    );
    for (const file of RUNTIME_WASM) {
      const bytes = readFileSync(resolve(published.root, file));
      expect(bytes.subarray(0, 4).equals(WASM_MAGIC), `${file} is a WASM module`).toBe(true);
    }
    for (const file of RUNTIME_SCRIPTS) {
      const source = scriptSource(published.root, file);
      expect(source, file).not.toMatch(/from\s+['"]@riftydev\//);
      expect(source, file).not.toMatch(/import\s+['"]@riftydev\//);
      expect(source, file).toMatch(/addEventListener\s*\(/);
    }
  });

  it('documents the required host headers on the published manifest', () => {
    const { manifest } = readPublishedRuntime();
    for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
      expect(manifest.headers[name], name).toBe(value);
    }
  });

  it('kernel asset publishes a sibling quickjs.wasm URL before the kernel listener', () => {
    const kernel = scriptSource(readPublishedRuntime().root, 'kernel-worker.js');
    const sibling = kernel.search(SIBLING_QUICKJS_URL);
    const envKey = kernel.indexOf('__RIFTY_QUICKJS_WASM_URL');
    const listener = kernel.search(MESSAGE_LISTENER);
    expect(sibling, 'new URL("./quickjs.wasm", import.meta.url)').toBeGreaterThan(-1);
    expect(envKey, '__RIFTY_QUICKJS_WASM_URL assignment').toBeGreaterThan(-1);
    expect(listener, 'kernel message listener').toBeGreaterThan(-1);
    expect(sibling).toBeLessThan(listener);
    expect(envKey).toBeLessThan(listener);
  });

  it('rejects a published copy that omits a listed worker before guest start', async () => {
    await withIncompleteCopy('owner-worker.js', async (incompleteRoot) => {
      expect(existsSync(join(incompleteRoot, 'kernel-worker-entry.ts'))).toBe(false);
      expect(existsSync(join(incompleteRoot, 'host-builtins.ts'))).toBe(false);
      const probed = await fetchCopyAssets(incompleteRoot, 'owner-worker.js', 'kernel-worker.js');
      expect(probed.missing).toBe(404);
      expect(probed.present).toBe(200);
    });
  });

  it('rejects a published copy that omits sibling quickjs.wasm before guest start', async () => {
    await withIncompleteCopy('quickjs.wasm', async (incompleteRoot) => {
      const probed = await fetchCopyAssets(incompleteRoot, 'quickjs.wasm', 'kernel-worker.js');
      expect(probed.missing).toBe(404);
      expect(probed.present).toBe(200);
    });
  });
});
