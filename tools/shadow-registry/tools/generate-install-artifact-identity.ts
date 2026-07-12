import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bakedOverrides, internalsShims } from '../src/index.ts';
import { identityForRecipe } from '../src/install-artifact-recipe.ts';

const policyUrl = new URL('../esbuild-runtime-policy.json', import.meta.url);
const runtimeManifestUrl = new URL('../generated/esbuild-runtime-manifest.json', import.meta.url);
const outputUrl = new URL(
  '../../../apps/playground/src/generated/install-artifact-identity.json',
  import.meta.url,
);

interface RuntimeManifest {
  readonly output?: { readonly sha256?: unknown; readonly bytes?: unknown };
}

interface InstallArtifactIdentityFile {
  readonly schema: 1;
  readonly identity: string;
}

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, 'utf8')) as unknown;
}

async function readRuntimeOutputIdentity(): Promise<RuntimeManifest['output'] | null> {
  let parsed: RuntimeManifest;
  try {
    parsed = (await readJson(runtimeManifestUrl)) as RuntimeManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const sha256 = parsed.output?.sha256;
  const bytes = parsed.output?.bytes;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('esbuild runtime manifest: output.sha256 must be a SHA-256 hex digest');
  }
  if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0) {
    throw new Error('esbuild runtime manifest: output.bytes must be a positive safe integer');
  }
  return { sha256, bytes };
}

export async function buildInstallArtifactIdentityFile(): Promise<InstallArtifactIdentityFile> {
  const recipe = {
    schema: 1,
    bakedOverrides,
    internalsShims,
    esbuildRuntimePolicy: await readJson(policyUrl),
    esbuildRuntimeOutput: await readRuntimeOutputIdentity(),
  };
  return { schema: 1, identity: identityForRecipe(recipe) };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: generate-install-artifact-identity.ts --write|--check');
  }
  const expected = `${JSON.stringify(await buildInstallArtifactIdentityFile(), null, 2)}\n`;
  if (mode === '--write') {
    await mkdir(dirname(fileURLToPath(outputUrl)), { recursive: true });
    await writeFile(outputUrl, expected);
    console.log(`install artifact identity: wrote ${fileURLToPath(outputUrl)}`);
    return;
  }
  let actual: string;
  try {
    actual = await readFile(outputUrl, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`install artifact identity missing: ${fileURLToPath(outputUrl)}`);
    }
    throw error;
  }
  if (actual !== expected) {
    throw new Error('install artifact identity drifted; run `pnpm artifacts:generate`');
  }
  console.log('install artifact identity: current');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
