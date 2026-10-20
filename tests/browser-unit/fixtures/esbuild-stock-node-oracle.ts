import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EsbuildContractTranscript,
  EsbuildGuestPolicyTranscript,
} from '../../../tools/shadow-registry/src/esbuild-contract-probe.ts';

export interface StockNodeOracle {
  readonly contract: EsbuildContractTranscript;
  readonly policy: EsbuildGuestPolicyTranscript;
}

/** Execute the unchanged shared browser probe in a real Node process. */
export function captureStockNodeOracle(bundle: string, workspaceFactory: string): StockNodeOracle {
  const require = createRequire(
    new URL('../../../tools/shadow-registry/package.json', import.meta.url),
  );
  const entry = require.resolve('esbuild-wasm');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rifty-stock-node-oracle-')));
  try {
    const output = join(root, 'result.json');
    const runner = join(root, 'probe.cjs');
    writeFileSync(
      runner,
      `${bundle}
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cjs = require(${JSON.stringify(entry)});
${workspaceFactory}
(async () => {
  try {
    const esm = await import(pathToFileURL(${JSON.stringify(entry)}).href);
    const modules = { cjs, esm, esmDefaultIsCjsOuter: esm.default === cjs,
      esmNamespaceStable: esm === await import(pathToFileURL(${JSON.stringify(entry)}).href) };
    const contract = await RiftyEsbuildContractProbe.probeEsbuildContract(modules, makeContractWorkspace(${JSON.stringify(join(root, 'oracle-parity-workspace'))}));
    const policy = await RiftyEsbuildContractProbe.probeEsbuildGuestPolicy(modules, makeContractWorkspace(${JSON.stringify(join(root, 'oracle-policy-workspace'))}));
    fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({ contract, policy }));
  } finally { await cjs.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
`,
    );
    execFileSync(process.execPath, [runner], { cwd: root, timeout: 30_000, encoding: 'utf8' });
    return JSON.parse(readFileSync(output, 'utf8')) as StockNodeOracle;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
