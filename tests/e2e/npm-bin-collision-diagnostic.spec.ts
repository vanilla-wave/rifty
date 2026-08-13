import { expect, test } from '@playwright/test';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

const EXPECTED_DIAGNOSTIC =
  'npm: install failed: Not implemented: npm-client.bin-collision-reify (invariant=prior-owner-continuity nodeModulesDir=node_modules command=proto-loader-gen-types priorOwner=@grpc/proto-loader currentOwner=<none>)';
const EXPECTED_PRIOR_SET_DIAGNOSTIC =
  'npm: install failed: Not implemented: npm-client.bin-collision-reify (invariant=claim-uniqueness claimSet=prior nodeModulesDir=node_modules command=proto-loader-gen-types firstOwner=@grpc/proto-loader secondOwner=provider-z)';

function commandOutput(buffer: string, line: string): string {
  const normalized = buffer.replaceAll('\r\n', '\n');
  const marker = `> ${line}`;
  const start = normalized.lastIndexOf(marker);
  if (start < 0) throw new Error(`terminal command marker missing: ${line}`);
  return normalized.slice(start + marker.length).replace(/^\n/u, '');
}

test.describe('npm bin-collision diagnostics', () => {
  test('[fault: provenance-lie][fault: lossy-aggregate][fault: sibling-drift] keeps prior-owner roles exact at the terminal', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    await bootShell(page);
    await openShellTerminal(page);

    const seedLockScript =
      'import fs from "node:fs";const path="package-lock.json";const lock=JSON.parse(fs.readFileSync(path,"utf8"));lock.packages["node_modules/@grpc/proto-loader"]={version:"0.7.15",peer:true,bin:{"proto-loader-gen-types":"build/bin/proto-loader-gen-types.js"}};fs.writeFileSync(path,JSON.stringify(lock,null,2)+"\\n");lock.packages["node_modules/provider-z"]={version:"1.0.0",peer:true,bin:{"proto-loader-gen-types":"bin/provider.js"}};fs.writeFileSync(".prior-duplicate-package-lock.json",JSON.stringify(lock,null,2)+"\\n");';
    const setupLine = [
      'mkdir -p node_modules/@grpc/proto-loader/build/bin',
      'mkdir -p node_modules/provider-z/bin',
      `echo '${seedLockScript}' > .seed-prior-lock.mjs`,
      'node .seed-prior-lock.mjs',
      'rm .seed-prior-lock.mjs',
      `echo '{"name":"@grpc/proto-loader","version":"0.7.15","bin":{"proto-loader-gen-types":"build/bin/proto-loader-gen-types.js"}}' > node_modules/@grpc/proto-loader/package.json`,
      `echo 'console.log("prior owner")' > node_modules/@grpc/proto-loader/build/bin/proto-loader-gen-types.js`,
      `echo '{"name":"provider-z","version":"1.0.0","bin":{"proto-loader-gen-types":"bin/provider.js"}}' > node_modules/provider-z/package.json`,
      `echo 'console.log("second prior owner")' > node_modules/provider-z/bin/provider.js`,
    ].join(' && ');
    await runTerminalLineSettled(page, setupLine, 30_000);
    expect(await terminalHistoryExitCode(page, setupLine)).toBe(0);

    const installLine = 'npm install';
    await runTerminalLineSettled(page, installLine, 120_000);
    expect(await terminalHistoryExitCode(page, installLine)).toBe(1);
    const diagnosticLines = commandOutput(await terminalBuffer(page), installLine)
      .split('\n')
      .filter((line) => line.startsWith('npm: install failed:'));
    expect(diagnosticLines).toEqual([EXPECTED_DIAGNOSTIC]);

    const duplicateSetupLine =
      'cp .prior-duplicate-package-lock.json package-lock.json && rm .prior-duplicate-package-lock.json';
    await runTerminalLineSettled(page, duplicateSetupLine, 30_000);
    expect(await terminalHistoryExitCode(page, duplicateSetupLine)).toBe(0);

    await runTerminalLineSettled(page, installLine, 120_000);
    expect(await terminalHistoryExitCode(page, installLine)).toBe(1);
    const priorSetDiagnosticLines = commandOutput(await terminalBuffer(page), installLine)
      .split('\n')
      .filter((line) => line.startsWith('npm: install failed:'));
    expect(priorSetDiagnosticLines).toEqual([EXPECTED_PRIOR_SET_DIAGNOSTIC]);
  });
});
