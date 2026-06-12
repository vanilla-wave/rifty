import {
  type Fetcher,
  type Packument,
  RegistryClient,
  type VersionManifest,
} from '@riftydev/npm-client';
import { browserShimLifecycleScriptSkips } from '@riftydev/shadow-registry';

export class ViteRegistryClient extends RegistryClient {
  override async getPackument(name: string): Promise<Packument> {
    return stripBrowserShimLifecycleScripts(name, await super.getPackument(name));
  }
}

export function createViteRegistryClient(fetch: Fetcher): RegistryClient {
  return new ViteRegistryClient({ fetch });
}

export function stripBrowserShimLifecycleScripts(name: string, packument: Packument): Packument {
  const skips = browserShimLifecycleScriptSkips[name];
  if (!skips) return packument;

  let changed = false;
  const versions: Record<string, VersionManifest> = {};
  for (const [version, manifest] of Object.entries(packument.versions)) {
    const skippedScripts = skips.find((skip) => skip.version === version)?.scripts;
    if (!skippedScripts) {
      versions[version] = manifest;
      continue;
    }

    const scripts = stripScripts(manifest.scripts, skippedScripts);
    if (scripts === manifest.scripts) {
      versions[version] = manifest;
      continue;
    }

    changed = true;
    versions[version] =
      scripts && Object.keys(scripts).length > 0
        ? { ...manifest, scripts }
        : withoutScripts(manifest);
  }

  return changed ? { ...packument, versions } : packument;
}

function stripScripts(
  scripts: Record<string, string> | undefined,
  skipped: readonly string[],
): Record<string, string> | undefined {
  if (!scripts) return scripts;
  let changed = false;
  const next = { ...scripts };
  for (const script of skipped) {
    if (next[script] === undefined) continue;
    delete next[script];
    changed = true;
  }
  return changed ? next : scripts;
}

function withoutScripts(manifest: VersionManifest): VersionManifest {
  const { scripts: _scripts, ...rest } = manifest;
  return rest;
}
