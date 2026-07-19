import { describe, expect, it } from 'vitest';
import { viteRootWatchPatchPolicy } from '../../packages/workbench/src/workers/vite-cli-install-policy.ts';
import { viteConfigTempPatchPolicy } from '../../packages/workbench/src/workers/vite-config-temp-patch-policy.ts';
import { proveViteInstallPatchInput } from '../shadow-registry/tools/check-dep-snapshot-artifacts.ts';

const encoder = new TextEncoder();

function viteInstallFiles(version: '7.3.6' | '8.0.16'): Map<string, Uint8Array> {
  const policy = viteConfigTempPatchPolicy.sources.find(
    (candidate) => candidate.version === version,
  );
  if (!policy) throw new Error(`missing test policy for Vite ${version}`);
  return new Map([
    ['vite/package.json', encoder.encode(JSON.stringify({ name: 'vite', version }))],
    [
      'vite/dist/node/cli.js',
      encoder.encode('class Cli { parse() { this.runMatchedCommand(); } }'),
    ],
    [
      `vite/${policy.relativeSourcePath}`,
      encoder.encode(`${viteRootWatchPatchPolicy.needle}\n${policy.upstreamBlock}`),
    ],
  ]);
}

describe('snapshot Vite acquisition proof', () => {
  it.each(['7.3.6', '8.0.16'] as const)('accepts exact Vite %s version/path/anchor', (version) => {
    expect(() => proveViteInstallPatchInput(viteInstallFiles(version))).not.toThrow();
  });

  it('rejects a valid Vite 8 block under the Vite 7 chunk path', () => {
    const files = viteInstallFiles('8.0.16');
    const source = files.get('vite/dist/node/chunks/node.js');
    if (!source) throw new Error('missing Vite 8 test source');
    files.delete('vite/dist/node/chunks/node.js');
    files.set('vite/dist/node/chunks/config.js', source);

    expect(() => proveViteInstallPatchInput(files)).toThrow(/dist\/node\/chunks\/node\.js/);
  });

  it('rejects drift inside the otherwise recognizable config-loader function', () => {
    const files = viteInstallFiles('7.3.6');
    const path = 'vite/dist/node/chunks/config.js';
    const source = Buffer.from(files.get(path) ?? []).toString('utf8');
    files.set(
      path,
      encoder.encode(source.replace('pathToFileURL(tempFileName).href', 'tempFileName')),
    );

    expect(() => proveViteInstallPatchInput(files)).toThrow(/config-temp input/);
  });
});
