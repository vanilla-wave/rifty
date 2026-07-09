/**
 * Page-side driver for the REAL esbuild-wasm host (browser-unit lane): no
 * fakeLib — the actual 0.28.0 wasm service initializes over a Memory VFS and
 * the checks pin the native-parity behaviors the unit fakes cannot prove
 * (real Go fs facade round-trip, real `<stdout>` shape, real relative-path
 * resolution through absWorkingDir).
 */
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { installEsbuildBridge } from '../../../apps/playground/src/workers/esbuild-host.ts';

export interface RealEsbuildReport {
  readonly version: string;
  readonly transformed: string;
  readonly relativeOutdirWrote: boolean;
  readonly buildHasOutputFiles: boolean;
  readonly noOutfileWroteNothing: boolean;
  readonly noOutfileHasOutputFiles: boolean;
}

export async function runRealEsbuildChecks(): Promise<RealEsbuildReport> {
  const fs = new MemoryFsSync();
  fs.loadFixture({ '/proj/src/in.js': 'export const answer = 42;' });
  setSyncMirror(fs);
  // Guest cwd for absWorkingDir defaulting (the harness page has no process).
  (globalThis as { process?: unknown }).process = { cwd: () => '/proj' };
  installEsbuildBridge();
  const host = (globalThis as { __riftyEsbuild?: unknown }).__riftyEsbuild as {
    version: string;
    transform(input: string, options?: object): Promise<{ code: string }>;
    build(options: object): Promise<{ outputFiles?: unknown }>;
  };

  const transformed = (await host.transform('let x: number = 1;', { loader: 'ts' })).code.trim();

  const built = await host.build({ entryPoints: ['src/in.js'], outdir: 'dist', bundle: false });
  const relativeOutdirWrote = fs.existsSync('/proj/dist/in.js');

  const before = fs.readdirSync('/proj').length + fs.readdirSync('/').length;
  const noOut = await host.build({ entryPoints: ['/proj/src/in.js'], bundle: false });
  const after = fs.readdirSync('/proj').length + fs.readdirSync('/').length;

  return {
    version: host.version,
    transformed,
    relativeOutdirWrote,
    buildHasOutputFiles: 'outputFiles' in built,
    noOutfileWroteNothing: before === after,
    noOutfileHasOutputFiles: 'outputFiles' in noOut,
  };
}
