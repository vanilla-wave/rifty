import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import type { CommandContext } from '@riftydev/shell';
import {
  type PackageAcquisitionAuthorityOptions,
  createPackageAcquisitionAuthority,
} from '../workers/package-acquisition-authority.ts';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from './install-stamp-authority.ts';
import {
  type NpmShellCommandDeps,
  executeNpmInstallOperation,
  parseNpmInstallRequest,
} from './npm-shell-command.ts';

type TestNpmShellCommandDeps = Omit<NpmShellCommandDeps, 'packageAcquisitionAuthority'>;

/** Focused unit owner. Production must inject its lifetime package authority. */
export function createTestNpmPackageAcquisitionAuthority(
  deps: TestNpmShellCommandDeps,
  options: Readonly<{
    stamps?: InstallStampAuthority;
    resolveTreeGuards?: PackageAcquisitionAuthorityOptions['resolveTreeGuards'];
  }> = {},
) {
  const authority = createPackageAcquisitionAuthority({
    stamps: options.stamps ?? createInstallStampAuthority({ vfs: deps.vfs }),
    ...(deps.flush ? { stampTransition: { flush: deps.flush } } : {}),
    ...(options.resolveTreeGuards === undefined
      ? {}
      : { resolveTreeGuards: options.resolveTreeGuards }),
    adapter: {
      planSnapshotRestore: async () => ({ status: 'rejected', reason: 'not configured' }),
      install: async (request, execution) => {
        const parsed = parseNpmInstallRequest(
          request.type === 'terminal-install' ? request.argv : [],
        );
        if (parsed.status === 'rejected') throw new Error(parsed.message.trimEnd());
        const sink = { write: (_chunk: string | Uint8Array): void => {} };
        const context: CommandContext =
          request.type === 'terminal-install'
            ? (request.context ??
              (() => {
                throw new Error('terminal package acquisition requires its shell context');
              })())
            : { cwd: request.project.root, env: {}, stdout: sink, stderr: sink };
        const installed = await executeNpmInstallOperation(
          parsed.request,
          context,
          deps,
          execution,
        );
        if ('status' in installed) return installed;
        return {
          ...installed,
          shadowPlan: planShadowSubstitutionsFromLockfile(installed.result.lockfile),
        };
      },
      reset: async () => {
        throw new Error('test npm package reset is not configured');
      },
      switchProject: async () => {
        throw new Error('test npm project switch is not configured');
      },
    },
  });
  return authority;
}
