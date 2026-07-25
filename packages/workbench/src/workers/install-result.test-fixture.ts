import { type InstallResult, RegistryClient, install } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';

const noNetworkRegistry = new RegistryClient({
  baseUrl: 'https://install-result-fixture.test',
  fetch: async () => {
    throw new Error('empty install-result fixture must not read the registry');
  },
});

/** Produces the identity carried by the real installer-owned shadow-plan boundary. */
export async function createNoShadowInstallResultFixture(
  value: InstallResult,
): Promise<InstallResult> {
  if (value.lockfile.rifty?.shadowSubstitutions !== undefined) {
    throw new TypeError('no-shadow install-result fixture received a shadow trace');
  }
  const vfs = new MemoryVfs();
  const cwd = '/install-result-fixture';
  await vfs.mkdir(cwd, { recursive: true });
  const owned = await install(
    'install-result-fixture',
    '1.0.0',
    {},
    {
      vfs,
      cwd,
      registry: noNetworkRegistry,
    },
  );
  return Object.assign(owned, value);
}
