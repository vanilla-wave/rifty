import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  readActiveProjectText,
} from './helpers/playground.ts';

interface ProjectManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly overrides?: Readonly<Record<string, string>>;
  readonly version?: string;
}

function manifest(text: string, label: string): ProjectManifest {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} is not a package manifest`);
  }
  return parsed as ProjectManifest;
}

test('instant Vite 8 snapshot survives an A→B→A switch with its visible runtime policy', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(300_000);
  const acquisitionPaths: string[] = [];
  context.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/snapshots/') || path.startsWith('/npm-registry')) {
      acquisitionPaths.push(path);
    }
  });

  await bootProjectFiles(page);
  await expectViteDevServerReady(page, 5174, 120_000);
  await openShellTerminal(page);
  const firstA = await readActiveProjectText(page, 'package.json');
  if (!firstA.exists) throw new Error('first A package.json missing');

  await pickStarter(page, 'vite8');
  await expectViteDevServerReady(page, 5174, 180_000);
  await openShellTerminal(page);
  const projectB = await readActiveProjectText(page, 'package.json');
  const runtimeB = await readActiveProjectText(
    page,
    'node_modules/@napi-rs/wasm-runtime/package.json',
  );
  if (!projectB.exists || !runtimeB.exists) throw new Error('Vite 8 snapshot tree incomplete');

  await pickStarter(page, 'project-files');
  await expectViteDevServerReady(page, 5174, 120_000);
  await openShellTerminal(page);
  const secondA = await readActiveProjectText(page, 'package.json');
  if (!secondA.exists) throw new Error('second A package.json missing');

  expect(manifest(projectB.text, 'Vite 8 package.json')).toMatchObject({
    dependencies: { vite: '8.0.16' },
    overrides: {
      '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.1.6',
    },
  });
  expect(manifest(runtimeB.text, 'Vite 8 WASI runtime package.json').version).toBe('1.1.6');
  expect(secondA.text).toBe(firstA.text);
  expect(acquisitionPaths.filter((path) => path.startsWith('/npm-registry'))).toEqual([]);
  expect(acquisitionPaths).toEqual(
    expect.arrayContaining([
      '/snapshots/vite-node-modules.json.gz',
      '/snapshots/vite8-node-modules.json.gz',
    ]),
  );
});
