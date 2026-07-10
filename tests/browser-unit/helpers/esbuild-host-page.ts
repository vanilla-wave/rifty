/**
 * Page-side driver for the REAL esbuild-wasm host (browser-unit lane): no
 * fakeLib — the actual 0.28.0 wasm service initializes over a Memory VFS and
 * the checks pin the native-parity behaviors the unit fakes cannot prove
 * (real Go fs facade round-trip, real `<stdout>` shape, real relative-path
 * resolution through absWorkingDir, real plugin surface: masked
 * pluginBuild.esbuild + setup() write flips).
 */
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { installEsbuildBridge } from '../../../apps/playground/src/workers/esbuild-host.ts';

export interface RealEsbuildReport {
  readonly version: string;
  readonly transformed: string;
  readonly relativeOutdirWrote: boolean;
  readonly buildOutputFiles: string;
  readonly noOutfileWroteNothing: boolean;
  readonly noOutfileOutputFiles: string;
  readonly pluginSawWrite: unknown;
  readonly pluginOnEndFileOnDisk: boolean;
  readonly pluginOnEndOutputFiles: string;
  readonly pluginBuildOutputFiles: string;
  readonly writeFlipOutputFiles: string;
  readonly writeFlipDiskUntouched: boolean;
  readonly pluginEsbuildKeys: string;
  readonly pluginEsbuildDefaultIsSelf: boolean;
  readonly pluginEsbuildBuildSyncError: string;
}

/**
 * Own-key shape of `result.outputFiles`. Native write-effective oracle (real
 * esbuild 0.28.0, probed 2026-07-10): 'own-enumerable-undefined' — the key is
 * OWN + ENUMERABLE with value `undefined`, never absent.
 */
function outputFilesShape(r: object): string {
  if (!Object.prototype.hasOwnProperty.call(r, 'outputFiles')) return 'missing';
  const value = (r as { outputFiles?: unknown }).outputFiles;
  if (value === undefined) {
    const enumerable = Object.getOwnPropertyDescriptor(r, 'outputFiles')?.enumerable === true;
    return enumerable ? 'own-enumerable-undefined' : 'own-non-enumerable-undefined';
  }
  return Array.isArray(value) ? `array(${value.length})` : 'other';
}

type ProbePluginBuild = {
  initialOptions: Record<string, unknown>;
  esbuild: unknown;
  onEnd(cb: (r: Record<string, unknown>) => void): void;
};

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
    build(options: object): Promise<object>;
  };

  const transformed = (await host.transform('let x: number = 1;', { loader: 'ts' })).code.trim();

  const built = await host.build({ entryPoints: ['src/in.js'], outdir: 'dist', bundle: false });
  const relativeOutdirWrote = fs.existsSync('/proj/dist/in.js');

  const before = fs.readdirSync('/proj').length + fs.readdirSync('/').length;
  const noOut = await host.build({ entryPoints: ['/proj/src/in.js'], bundle: false });
  const after = fs.readdirSync('/proj').length + fs.readdirSync('/').length;

  // Plugin-visible write surface against the REAL service: initialOptions
  // reads the caller's write:true, onEnd sees the file already in the VFS and
  // the native result shape (own enumerable `outputFiles: undefined`), and
  // pluginBuild.esbuild is the masked module view, not the raw wasm lib.
  let pluginSawWrite: unknown = 'unset';
  let pluginOnEndFileOnDisk = false;
  let pluginOnEndOutputFiles = 'unset';
  let pluginEsbuild: Record<string, unknown> = {};
  const pluginBuild = await host.build({
    entryPoints: ['src/in.js'],
    outdir: 'plugout',
    bundle: false,
    write: true,
    plugins: [
      {
        name: 'probe',
        setup(b: ProbePluginBuild) {
          pluginSawWrite = b.initialOptions.write;
          pluginEsbuild = b.esbuild as Record<string, unknown>;
          b.onEnd((r) => {
            pluginOnEndFileOnDisk = fs.existsSync('/proj/plugout/in.js');
            pluginOnEndOutputFiles = outputFilesShape(r);
          });
        },
      },
    ],
  });
  let pluginEsbuildBuildSyncError = 'no-throw';
  try {
    (pluginEsbuild.buildSync as () => unknown)();
  } catch (err) {
    const e = err as { name?: string; feature?: string };
    pluginEsbuildBuildSyncError = `${e.name}:${e.feature}`;
  }

  // A plugin setup() flipping initialOptions.write to false must be honored
  // (real-esbuild oracle: outputFiles stay in memory, disk untouched).
  const writeFlip = await host.build({
    entryPoints: ['src/in.js'],
    outdir: 'flipout',
    bundle: false,
    write: true,
    plugins: [
      {
        name: 'flip',
        setup(b: ProbePluginBuild) {
          b.initialOptions.write = false;
        },
      },
    ],
  });

  return {
    version: host.version,
    transformed,
    relativeOutdirWrote,
    buildOutputFiles: outputFilesShape(built),
    noOutfileWroteNothing: before === after,
    noOutfileOutputFiles: outputFilesShape(noOut),
    pluginSawWrite,
    pluginOnEndFileOnDisk,
    pluginOnEndOutputFiles,
    pluginBuildOutputFiles: outputFilesShape(pluginBuild),
    writeFlipOutputFiles: outputFilesShape(writeFlip),
    writeFlipDiskUntouched: !fs.existsSync('/proj/flipout/in.js'),
    pluginEsbuildKeys: Reflect.ownKeys(pluginEsbuild).map(String).sort().join(','),
    pluginEsbuildDefaultIsSelf: pluginEsbuild.default === pluginEsbuild,
    pluginEsbuildBuildSyncError,
  };
}
